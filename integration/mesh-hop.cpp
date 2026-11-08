// Integration adapter around the firmware's actual portable protocol helpers.
// Models three forwarding steps and BLE fragmentation; it does not emulate RF propagation.
#include "../firmware/include/mesh_protocol.h"
#include <iostream>
#include <iomanip>
#include <string>

int nibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const std::string input(argv[1]);
  if (input.size() % 2 != 0 || input.size() > em::MaxFrame * 2) return 3;
  em::Frame frame;
  frame.length = input.size() / 2;
  for (size_t i = 0; i < frame.length; ++i) {
    const int high = nibble(input[2*i]), low = nibble(input[2*i+1]);
    if (high < 0 || low < 0) return 4;
    frame.bytes[i] = static_cast<uint8_t>((high << 4) | low);
  }
  if (!em::validEnvelope(frame, 1, 1) || frame.bytes[14] != 3) return 5;
  for (uint8_t step = 0; step < 3; ++step) {
    em::DuplicateCache<8> duplicates;
    const uint32_t time = 10000U * step;
    if (!duplicates.admit(frame, time) || duplicates.admit(frame, time + 1)) return 6;
    if (frame.bytes[14] == 0) return 7;
    --frame.bytes[14];
    em::FrameQueue<2> queue;
    if (!queue.push(frame, time + 100) || queue.takeDue(time, frame) || !queue.takeDue(time + 100, frame)) return 8;
    em::Reassembler assembler;
    em::Frame assembled;
    const size_t count = (frame.length + em::ChunkPayload - 1) / em::ChunkPayload;
    // Reverse delivery exercises indexed reassembly, including short final chunks.
    for (size_t n = count; n > 0; --n) {
      uint8_t chunk[20]{};
      const size_t length = em::makeChunk(frame, step, static_cast<uint8_t>(n-1), chunk);
      const auto result = assembler.accept(chunk, length, time + 200, assembled);
      if (n == 1 ? result != em::Assembly::Complete : result != em::Assembly::Pending) return 9;
    }
    if (assembled.length != frame.length || memcmp(assembled.bytes, frame.bytes, frame.length) != 0) return 10;
    frame = assembled;
  }
  for (size_t i = 0; i < frame.length; ++i) std::cout << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned>(frame.bytes[i]);
  std::cout << '\n';
  return 0;
}
