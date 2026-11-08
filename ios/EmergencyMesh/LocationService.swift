import Foundation
import CoreLocation
import Combine

final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var fix: LocationFix?
    @Published private(set) var message = "Unknown — location is not attached"
    @Published private(set) var requesting = false
    private let manager = CLLocationManager()
    private var timeout: DispatchWorkItem?
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest; manager.distanceFilter = 10 }
    func request() {
        guard CLLocationManager.locationServicesEnabled() else { message = "Location Services are off. You can send without GPS."; return }
        switch manager.authorizationStatus {
        case .notDetermined: requesting = true; manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            requesting = true; message = "Finding a recent location…"; manager.requestLocation()
            timeout?.cancel(); let item = DispatchWorkItem { [weak self] in self?.requesting = false; self?.message = "Location timed out. You can send without GPS." }
            timeout = item; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: item)
        case .denied, .restricted: requesting = false; fix = nil; message = "Location permission denied. Describe your location in notes."
        @unknown default: requesting = false; message = "Location unavailable. You can send without GPS."
        }
    }
    func clear() { fix = nil; message = "Unknown — location is not attached"; timeout?.cancel(); requesting = false }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if requesting { request() }
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { clear(); message = "Location permission denied. Describe your location in notes." }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        timeout?.cancel(); requesting = false
        guard let location = locations.last else { message = "No location returned."; return }
        let candidate = LocationFix(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                                    accuracy: location.horizontalAccuracy, capturedAt: location.timestamp)
        guard candidate.isUsable() else { fix = nil; message = "Only an old or invalid location is available. Sending without GPS."; return }
        fix = candidate; message = String(format: "%.5f, %.5f • ±%.0f m", candidate.latitude, candidate.longitude, candidate.accuracy)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        timeout?.cancel(); requesting = false; fix = nil; message = "Could not get location. Describe it in notes."
    }
}
