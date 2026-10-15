#!/bin/sh
# Plan 104: whisper.cpp's command-line program for a Mac, built from the same
# tag Windows downloads (b5130), since whisper.cpp publishes no Mac program.
# One file, linked statically, into vendor/whisper with whisper.cpp's licence,
# which the Mac build then carries inside the app.
#
#   scripts/build-whisper-mac.sh arm64    Apple Silicon, on the graphics chip (Metal)
#   scripts/build-whisper-mac.sh x86_64   Intel, on the processor
#
# Runs on a Mac with Xcode's command-line tools and cmake, as GitHub's macOS
# runners have. An Apple Silicon Mac builds either.
set -eu

ARCH="${1:?give the chip: arm64 or x86_64}"
TAG=b5130
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/whisper"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$ARCH" in
  arm64)
    METAL=ON
    CPU_FLAGS=""
    TARGET=14.0
    ;;
  x86_64)
    METAL=OFF
    # Every Intel Mac macOS 13 runs on has AVX2 and FMA; built for those, not for the machine building it.
    CPU_FLAGS="-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"
    TARGET=13.4
    ;;
  *)
    echo "build-whisper-mac: no such chip: $ARCH (arm64 or x86_64)" >&2
    exit 1
    ;;
esac

git clone --quiet --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$WORK/src"

# shellcheck disable=SC2086
cmake -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$TARGET" \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL="$METAL" \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  $CPU_FLAGS
cmake --build "$WORK/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$WORK/build/bin/whisper-cli" "$OUT/whisper-cli"
chmod 755 "$OUT/whisper-cli"
cp "$WORK/src/LICENSE" "$OUT/LICENSE"
echo "$TAG $ARCH" > "$OUT/build.txt"
file "$OUT/whisper-cli"
echo "build-whisper-mac: whisper-cli $TAG for $ARCH is in vendor/whisper"
