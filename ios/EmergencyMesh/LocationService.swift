import Foundation
import CoreLocation
import Combine

final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var fix: LocationFix?
    @Published private(set) var message = "GPS is starting. You can send without it."
    @Published private(set) var requesting = false
    private let manager = CLLocationManager()
    private var timeout: DispatchWorkItem?
    private var reportActive = false
    private var updating = false
    override init() {
        super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
    }

    // Called only while the report screen is visible in the foreground. Returning from
    // Settings or another tab automatically rechecks permission and starts a fresh fix.
    func setReportActive(_ active: Bool) {
        reportActive = active
        if active { request() }
        else {
            manager.stopUpdatingLocation(); updating = false
            timeout?.cancel(); timeout = nil; requesting = false
        }
    }

    func currentFix(at date: Date = Date()) -> LocationFix? {
        guard CLLocationManager.locationServicesEnabled(),
              manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else { return nil }
        // CLLocationManager may already have a newer fix than its last delivered callback.
        let cached = manager.location.map(Self.makeFix)
        return LocationFix.latestUsable([fix, cached].compactMap { $0 }, at: date)
    }

    func request() {
        guard CLLocationManager.locationServicesEnabled() else {
            stopForUnavailableLocation("Location Services are off. Add a landmark in notes."); return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            requesting = true; message = "Allow location to attach GPS automatically. You can send without it."
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            if let available = currentFix() { fix = available; describe(available) }
            else { requesting = true; message = "Finding GPS… You can send without it." }
            guard !updating else { return }
            // Continuous updates keep even a stationary user's fix fresh while composing.
            updating = true; manager.startUpdatingLocation()
            timeout?.cancel()
            let item = DispatchWorkItem { [weak self] in
                guard let self else { return }; self.requesting = false
                if let available = self.currentFix() { self.fix = available; self.describe(available) }
                else { self.message = "GPS is taking longer. Add a landmark; you can send now." }
            }
            timeout = item; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: item)
        case .denied, .restricted: stopForUnavailableLocation("GPS permission is off. Add a landmark in notes.")
        @unknown default: stopForUnavailableLocation("GPS is unavailable. Add a landmark in notes.")
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            stopForUnavailableLocation("GPS permission is off. Add a landmark in notes.")
        } else if reportActive { request() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard reportActive else { return }
        let candidates = locations.map(Self.makeFix) + [fix].compactMap { $0 }
        guard let candidate = LocationFix.latestUsable(candidates) else {
            message = "No recent GPS fix yet. Add a landmark in notes."; return
        }
        timeout?.cancel(); requesting = false; fix = candidate; describe(candidate)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard reportActive else { return }
        timeout?.cancel(); requesting = false
        if let available = currentFix() { fix = available; describe(available) }
        else { message = "GPS is unavailable. Add a landmark in notes." }
    }

    private static func makeFix(_ location: CLLocation) -> LocationFix {
        LocationFix(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                    accuracy: location.horizontalAccuracy, capturedAt: location.timestamp)
    }
    private func describe(_ location: LocationFix) {
        message = "About \(Int(location.accuracy.rounded(.up))) m accuracy · updated \(location.capturedAt.formatted(date: .omitted, time: .shortened))"
    }
    private func stopForUnavailableLocation(_ explanation: String) {
        manager.stopUpdatingLocation(); updating = false; timeout?.cancel(); timeout = nil
        requesting = false; fix = nil; message = explanation
    }
}
