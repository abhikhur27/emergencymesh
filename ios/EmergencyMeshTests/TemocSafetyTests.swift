import XCTest
@testable import EmergencyMesh

final class TemocSafetyTests: XCTestCase {
    func testMedicalRedFlagsUseSavedGuidanceBeforeGeneration() {
        for question in ["Someone is not breathing", "She is unconscious", "How much ibuprofen should I take?", "I have chest pain", "The bleeding will not stop"] {
            XCTAssertNotNil(TemocSafety.directResponse(for: question), question)
        }
        XCTAssertEqual(TemocSafety.directResponse(for: "There is heavy bleeding")?.id, "bleeding")
        XCTAssertEqual(TemocSafety.directResponse(for: "I am panicking and scared")?.id, "grounding")
        XCTAssertNil(TemocSafety.directResponse(for: "What should I put in a small emergency bag?"))
        XCTAssertNil(TemocSafety.directResponse(for: "How should I clean spills from the floor?"))
    }
    func testGeneratedMedicationAndDispatchClaimsAreNotDisplayed() {
        XCTAssertFalse(TemocSafety.screenGeneratedText("Take 250 mg now."))
        XCTAssertFalse(TemocSafety.screenGeneratedText("I have contacted the dispatcher."))
        XCTAssertFalse(TemocSafety.screenGeneratedText("An ambulance is on its way."))
        XCTAssertTrue(TemocSafety.screenGeneratedText("Keep a flashlight and a charged power bank in your bag."))
    }
    func testLikelyProfileKeysAreRejectedBeforeSavingChat() {
        XCTAssertTrue(TemocSafety.containsPrivateKey(String(repeating: "a", count: 64)))
        XCTAssertTrue(TemocSafety.containsPrivateKey("{\"keyHex\":\"not-a-key\"}"))
        XCTAssertFalse(TemocSafety.containsPrivateKey("My flashlight needs batteries."))
    }
    func testSeparateLocalChatsAndStorageBounds() throws {
        var first = TemocConversation(); first.messages.append(TemocMessage(role: .user, text: "First chat"))
        var second = TemocConversation(); second.messages.append(TemocMessage(role: .user, text: "Separate chat"))
        var archive = TemocArchive(); archive.chats = [first, second]; archive.selectedID = second.id
        try archive.validate()
        let roundTrip = try JSONDecoder().decode(TemocArchive.self, from: JSONEncoder().encode(archive))
        XCTAssertEqual(roundTrip.chats.count, 2); XCTAssertEqual(roundTrip.selectedID, second.id)
        XCTAssertEqual(roundTrip.chats[0].messages[0].text, "First chat")
        archive.chats = [first, first]; XCTAssertThrowsError(try archive.validate())
        archive.chats = [first]; archive.selectedID = second.id; XCTAssertThrowsError(try archive.validate())
    }
}
