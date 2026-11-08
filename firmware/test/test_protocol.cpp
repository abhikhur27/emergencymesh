#include <stdio.h>
#include <string.h>
#include "mesh_protocol.h"

using namespace em;
#define assert(condition) do { if (!(condition)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); return 1; } } while (0)

static Frame fixture(size_t length = 64) {
  Frame f{};
  f.length = length;
  for (size_t i = 0; i < length; ++i) f.bytes[i] = static_cast<uint8_t>(i);
  f.bytes[0] = 'E'; f.bytes[1] = 'M'; f.bytes[2] = 1; f.bytes[3] = 1;
  f.bytes[4] = 1; f.bytes[5] = 0; f.bytes[14] = 3; f.bytes[15] = 1;
  return f;
}

int main() {
  Frame f = fixture();
  assert(validEnvelope(f, 1, 1));
  Frame invalid = f; invalid.length = 43; assert(!validEnvelope(invalid, 1, 1));
  invalid = f; invalid.bytes[2] = 2; assert(!validEnvelope(invalid, 1, 1));
  invalid = f; invalid.bytes[3] = 9; assert(!validEnvelope(invalid, 1, 1));
  invalid = f; invalid.bytes[14] = 5; assert(!validEnvelope(invalid, 1, 1));
  invalid = fixture(185); assert(!validEnvelope(invalid, 1, 1));
  invalid = fixture(134); invalid.bytes[3] = 2; assert(validEnvelope(invalid, 1, 1));
  invalid.length = 135; assert(!validEnvelope(invalid, 1, 1));
  invalid.length = 53; assert(!validEnvelope(invalid, 1, 1));
  assert(!validEnvelope(f, 2, 1));
  assert(!validEnvelope(f, 1, 2));
  puts("PASS envelope rejects malformed, wrong region and key ID");

  // TTL alone changes on relaying: it must not change the loop identity.
  const uint64_t first = frameFingerprint(f);
  f.bytes[14] = 0; assert(first == frameFingerprint(f));
  f.bytes[30] ^= 1; assert(first != frameFingerprint(f));
  puts("PASS relay identity ignores only TTL");

  // Three real managed-flood hops leave the authenticated bytes untouched.
  f = fixture(); const Frame original = f;
  DuplicateCache<4> relays[3];
  for (int hop = 0; hop < 3; ++hop) {
    assert(relays[hop].admit(f, 1000));
    assert(decrementHops(f));
    assert(f.bytes[14] == 2 - hop);
    assert(memcmp(original.bytes, f.bytes, 14) == 0);
    assert(memcmp(original.bytes + 15, f.bytes + 15, f.length - 15) == 0);
    assert(!relays[hop].admit(f, 1001));
  }
  assert(!decrementHops(f));
  puts("PASS three-hop flood reaches TTL zero without modifying authenticated bytes");

  Reassembler a;
  f = fixture(220);
  Frame complete{};
  uint8_t chunk[20];
  // Indexed receive tolerates reordering but never assembles missing chunks.
  for (int i = 13; i >= 0; --i) {
    const size_t size = makeChunk(f, 7, static_cast<uint8_t>(i), chunk);
    assert(size >= 5 && size <= 20);
    const Assembly result = a.accept(chunk, size, 10 + (13 - i), complete);
    assert(result == (i == 0 ? Assembly::Complete : Assembly::Pending));
  }
  assert(complete.length == 220 && memcmp(complete.bytes, f.bytes, 220) == 0);
  assert(makeChunk(f, 7, 14, chunk) == 0);
  puts("PASS largest BLE frame reassembles out of order with no loss");

  makeChunk(f, 8, 0, chunk); assert(a.accept(chunk, 20, 100, complete) == Assembly::Pending);
  chunk[4] ^= 1; assert(a.accept(chunk, 20, 101, complete) == Assembly::Rejected);
  makeChunk(f, 9, 0, chunk); assert(a.accept(chunk, 19, 102, complete) == Assembly::Rejected);
  makeChunk(f, 9, 0, chunk); assert(a.accept(chunk, 20, 200, complete) == Assembly::Pending);
  makeChunk(f, 9, 1, chunk); assert(a.accept(chunk, 20, 5201, complete) == Assembly::Pending);
  for (int i = 2; i < 14; ++i) {
    size_t size = makeChunk(f, 9, static_cast<uint8_t>(i), chunk);
    assert(a.accept(chunk, size, 5202 + i, complete) == Assembly::Pending);
  }
  puts("PASS conflicting/short BLE chunks rejected and partial state expires");

  // Loop suppression must permit a genuine retry after its cooldown.
  DuplicateCache<4> cache;
  f = fixture();
  assert(cache.admit(f, 100));
  f.bytes[14]--;
  assert(!cache.admit(f, 101));
  assert(!cache.admit(f, 6099));
  assert(cache.admit(f, 6100));
  f.bytes[30]++;
  assert(cache.admit(f, 6101));
  puts("PASS duplicate loops suppressed but retry after 6s can recover receipt");

  FrameQueue<2> q;
  assert(q.push(f, 100)); assert(q.push(f, 200)); assert(!q.push(f, 300));
  assert(!q.takeDue(99, complete)); assert(q.takeDue(100, complete));
  assert(!q.takeDue(199, complete)); assert(q.takeDue(200, complete));
  assert(!q.takeDue(300, complete));
  assert(q.push(f, 0xfffffff0U)); assert(q.takeDue(0x00000010U, complete));
  puts("PASS bounded TX queue and due times handle clock wrap");
  return 0;
}
