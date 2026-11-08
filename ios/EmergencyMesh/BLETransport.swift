import Foundation
import CoreBluetooth
import Combine

final class BLETransport: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    struct Device: Identifiable { let peripheral: CBPeripheral; let rssi: Int; var id: UUID { peripheral.identifier }; var name: String { peripheral.name ?? "EmergencyMesh radio" } }
    static let serviceID = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    static let writeID = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    static let notifyID = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
    @Published private(set) var devices: [Device] = []
    @Published private(set) var status = "Not connected"
    @Published private(set) var ready = false
    @Published private(set) var scanning = false
    @Published private(set) var busy = false
    var onFrame: ((Data) -> Void)?
    var onReady: (() -> Void)?
    private var central: CBCentralManager!
    private var selected: CBPeripheral?
    private var writer: CBCharacteristic?
    private var notifier: CBCharacteristic?
    private var values: [Data] = []
    private var completion: ((Result<Void, Error>) -> Void)?
    private var writeTimeout: DispatchWorkItem?
    private var connectTimeout: DispatchWorkItem?
    private var assembler = BLEReassembler()
    private var desiredConnection = false

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionRestoreIdentifierKey: "EmergencyMesh.Radio.v1"])
    }
    func scan() {
        guard central.state == .poweredOn else { updateState(); return }
        devices = []; scanning = true; status = "Looking for radio devices…"
        central.scanForPeripherals(withServices: [Self.serviceID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.stopScan() }
    }
    func stopScan() { central.stopScan(); scanning = false; if selected == nil { status = devices.isEmpty ? "No radio found. Check power and firmware." : "Choose a radio device" } }
    func connect(_ device: Device) {
        if selected?.identifier == device.id, selected?.state == .connected || selected?.state == .connecting { return }
        desiredConnection = true; stopScan()
        let previous = selected
        resetLink("Changing radio device…")
        if let previous, previous.identifier != device.id { central.cancelPeripheralConnection(previous) }
        selected = device.peripheral; selected?.delegate = self; ready = false
        status = "Connecting to \(device.name)…"; central.connect(device.peripheral)
        armConnectionTimeout()
    }
    func disconnect() {
        desiredConnection = false; connectTimeout?.cancel(); stopScan()
        if let selected { central.cancelPeripheralConnection(selected) }
        selected = nil
        resetLink("Disconnected")
    }
    private func armConnectionTimeout() {
        connectTimeout?.cancel(); let work = DispatchWorkItem { [weak self] in
            guard let self, !self.ready else { return }; self.desiredConnection = false
            if let selected = self.selected { self.central.cancelPeripheralConnection(selected) }
            self.resetLink("Connection timed out. Check device power and retry.")
        }; connectTimeout = work; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
    }
    func send(_ frame: Data, completion: @escaping (Result<Void, Error>) -> Void) {
        guard ready, let selected, let writer, !busy else { completion(.failure(MeshError.invalid("Radio is not ready or is already sending."))); return }
        guard selected.maximumWriteValueLength(for: .withResponse) >= 20 else { completion(.failure(MeshError.invalid("Radio does not support 20-byte BLE writes."))); return }
        do { values = try BLEFraming.chunks(frame: frame, transferID: UInt8.random(in: .min ... .max)) }
        catch { completion(.failure(error)); return }
        self.completion = completion; busy = true; writeNext(selected, writer)
    }
    private func writeNext(_ peripheral: CBPeripheral, _ characteristic: CBCharacteristic) {
        guard desiredConnection, ready, peripheral.identifier == selected?.identifier else {
            finish(.failure(MeshError.invalid("Selected radio changed during transfer."))); return
        }
        guard !values.isEmpty else { finish(.success(())); return }
        writeTimeout?.cancel(); let work = DispatchWorkItem { [weak self] in
            self?.finish(.failure(MeshError.invalid("BLE write timed out. Delivery remains unconfirmed.")))
            self?.disconnect()
        }; writeTimeout = work; DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
        peripheral.writeValue(values[0], for: characteristic, type: .withResponse)
    }
    private func finish(_ result: Result<Void, Error>) {
        writeTimeout?.cancel(); values = []; busy = false; let callback = completion; completion = nil; callback?(result)
    }
    private func resetLink(_ message: String) {
        ready = false; writer = nil; notifier = nil; assembler.reset(); status = message
        if busy { finish(.failure(MeshError.invalid("Radio disconnected during transfer. Delivery remains unconfirmed."))) }
    }
    private func updateState() {
        switch central.state {
        case .poweredOn: if !ready { status = "Not connected" }
        case .poweredOff: resetLink("Bluetooth is off. Enable it in Settings.")
        case .unauthorized: resetLink("Bluetooth permission denied. Enable it in Settings.")
        case .unsupported: resetLink("Bluetooth is unavailable here. Use a physical iPhone for radio testing.")
        case .resetting: resetLink("Bluetooth is restarting…")
        default: status = "Checking Bluetooth…"
        }
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) { updateState() }
    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral], let peripheral = peripherals.first else { return }
        selected = peripheral; desiredConnection = true; peripheral.delegate = self
        if peripheral.state == .connected { peripheral.discoverServices([Self.serviceID]) } else { central.connect(peripheral); armConnectionTimeout() }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        if !devices.contains(where: { $0.id == peripheral.identifier }) { devices.append(Device(peripheral: peripheral, rssi: RSSI.intValue)) }
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral.identifier == selected?.identifier else { central.cancelPeripheralConnection(peripheral); return }
        peripheral.delegate = self; status = "Checking radio service…"; peripheral.discoverServices([Self.serviceID])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral.identifier == selected?.identifier else { return }
        connectTimeout?.cancel(); resetLink("Could not connect. Check power and retry.")
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral.identifier == selected?.identifier else { return }
        resetLink("Radio disconnected. Requests stay on this phone.")
        if desiredConnection { status = "Reconnecting…"; central.connect(peripheral); armConnectionTimeout() }
        else { selected = nil }
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard desiredConnection, peripheral.identifier == selected?.identifier else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.serviceID }) else { status = "Radio service unavailable. Check firmware."; return }
        peripheral.discoverCharacteristics([Self.writeID, Self.notifyID], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard desiredConnection, peripheral.identifier == selected?.identifier else { return }
        guard error == nil else { status = "Could not read radio characteristics."; return }
        writer = service.characteristics?.first { $0.uuid == Self.writeID && $0.properties.contains(.write) }
        notifier = service.characteristics?.first { $0.uuid == Self.notifyID && $0.properties.contains(.notify) }
        guard writer != nil, let notifier else { status = "Radio firmware is missing write/notify characteristics."; return }
        status = "Enabling radio receipts…"; peripheral.setNotifyValue(true, for: notifier)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard desiredConnection, peripheral.identifier == selected?.identifier, characteristic.uuid == Self.notifyID else { return }
        ready = error == nil && characteristic.isNotifying && writer != nil
        if ready { connectTimeout?.cancel(); status = peripheral.name ?? "Radio device connected"; onReady?() }
        else { resetLink("Receipt notifications unavailable. Reconnect the radio.") }
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard desiredConnection, peripheral.identifier == selected?.identifier, characteristic.uuid == Self.writeID, busy else { return }
        if let error { finish(.failure(error)); return }
        if !values.isEmpty { values.removeFirst() }; writeNext(peripheral, characteristic)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard desiredConnection, ready, peripheral.identifier == selected?.identifier, characteristic.uuid == Self.notifyID, error == nil, let value = characteristic.value else { return }
        do { if let frame = try assembler.accept(value) { onFrame?(frame) } }
        catch { assembler.reset() /* Invalid radio input is discarded; it cannot confirm a request. */ }
    }
}
