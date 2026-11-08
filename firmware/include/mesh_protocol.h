#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace em {
constexpr size_t MaxFrame = 220;
constexpr size_t MinFrame = 44;
constexpr size_t ChunkPayload = 16;
constexpr uint32_t AssemblyTimeout = 5000;
constexpr uint32_t DuplicateCooldown = 6000;
struct Frame { uint8_t bytes[MaxFrame]{}; size_t length = 0; };
enum class Assembly { Pending, Complete, Rejected };
inline bool validEnvelope(const Frame& f, uint16_t region, uint8_t keyId) {
  if (f.length < MinFrame || f.length > MaxFrame) return false;
  const bool correctSize = (f.bytes[3] == 1 && f.length >= 64 && f.length <= 184) ||
      (f.bytes[3] == 2 && f.length >= 54 && f.length <= 134);
  return correctSize && f.bytes[0] == 'E' &&
      f.bytes[1] == 'M' && f.bytes[2] == 1 && (f.bytes[3] == 1 || f.bytes[3] == 2) &&
      f.bytes[4] == static_cast<uint8_t>(region) && f.bytes[5] == static_cast<uint8_t>(region >> 8) &&
      f.bytes[14] <= 4 && f.bytes[15] == keyId;
}

inline bool decrementHops(Frame& f) {
  if (f.length < 16 || f.length > MaxFrame || f.bytes[14] == 0 || f.bytes[14] > 4) return false;
  --f.bytes[14]; return true;
}

// Noncryptographic loop key only. Hub/phone perform GCM authentication and strong replay digesting.
inline uint64_t frameFingerprint(const Frame& f) {
  uint64_t hash = 14695981039346656037ULL;
  for (size_t i = 0; i < f.length && i < MaxFrame; ++i) {
    if (i == 14) continue;
    hash ^= f.bytes[i]; hash *= 1099511628211ULL;
  }
  return hash;
}

inline size_t makeChunk(const Frame& f, uint8_t transfer, uint8_t index, uint8_t* out) {
  if (!f.length || f.length > MaxFrame) return 0;
  const size_t count = (f.length + ChunkPayload - 1) / ChunkPayload;
  if (index >= count) return 0;
  const size_t offset = static_cast<size_t>(index) * ChunkPayload;
  const size_t size = f.length - offset < ChunkPayload ? f.length - offset : ChunkPayload;
  out[0] = 0xe1; out[1] = transfer; out[2] = index; out[3] = static_cast<uint8_t>(count);
  memcpy(out + 4, f.bytes + offset, size);
  return size + 4;
}

class Reassembler {
 public:
  void reset() { active_ = false; seen_ = 0; count_ = 0; }
  Assembly accept(const uint8_t* bytes, size_t length, uint32_t now, Frame& out) {
    if (active_ && static_cast<uint32_t>(now - started_) > AssemblyTimeout) reset();
    if (length < 5 || length > 20 || bytes[0] != 0xe1) return reject();
    const uint8_t transfer = bytes[1], index = bytes[2], count = bytes[3];
    const size_t payload = length - 4;
    if (count == 0 || count > 14 || index >= count ||
        (index + 1 < count && payload != ChunkPayload) ||
        static_cast<size_t>(index) * ChunkPayload + payload > MaxFrame) return reject();
    if (!active_ || transfer != transfer_) {
      reset(); active_ = true; started_ = now; transfer_ = transfer; count_ = count;
    }
    if (count != count_) return reject();
    const size_t offset = static_cast<size_t>(index) * ChunkPayload;
    const uint16_t bit = static_cast<uint16_t>(1U << index);
    if ((seen_ & bit) && (sizes_[index] != payload || memcmp(buffer_ + offset, bytes + 4, payload))) return reject();
    memcpy(buffer_ + offset, bytes + 4, payload); sizes_[index] = static_cast<uint8_t>(payload); seen_ |= bit;
    if (seen_ != static_cast<uint16_t>((1U << count_) - 1)) return Assembly::Pending;
    out.length = static_cast<size_t>(count_ - 1) * ChunkPayload + sizes_[count_ - 1];
    memcpy(out.bytes, buffer_, out.length); reset();
    return Assembly::Complete;
  }
 private:
  Assembly reject() { reset(); return Assembly::Rejected; }
  uint8_t buffer_[MaxFrame]{};
  uint8_t sizes_[14]{};
  uint16_t seen_ = 0;
  uint8_t transfer_ = 0, count_ = 0;
  uint32_t started_ = 0;
  bool active_ = false;
};

template<size_t N> class DuplicateCache {
 public:
  bool admit(const Frame& f, uint32_t now) {
    const uint64_t key = frameFingerprint(f);
    size_t replacement = next_;
    for (size_t i = 0; i < N; ++i) {
      if (entries_[i].used && entries_[i].key == key) {
        if (static_cast<uint32_t>(now - entries_[i].last) < DuplicateCooldown) return false;
        replacement = i; break;
      }
    }
    entries_[replacement] = {key, now, true}; next_ = (replacement + 1) % N;
    return true;
  }
 private:
  struct Entry { uint64_t key = 0; uint32_t last = 0; bool used = false; };
  Entry entries_[N]{};
  size_t next_ = 0;
};

template<size_t N> class FrameQueue {
 public:
  bool push(const Frame& f, uint32_t due) {
    if (size_ == N || f.length > MaxFrame) return false;
    items_[(head_ + size_) % N] = {f, due}; ++size_; return true;
  }
  bool takeDue(uint32_t now, Frame& out) {
    if (!size_ || static_cast<int32_t>(now - items_[head_].due) < 0) return false;
    out = items_[head_].frame; head_ = (head_ + 1) % N; --size_; return true;
  }
  size_t size() const { return size_; }
 private:
  struct Item { Frame frame{}; uint32_t due = 0; };
  Item items_[N]{};
  size_t head_ = 0, size_ = 0;
};
}
