#!/bin/sh
# Plan 104: whisper.cpp's command-line program for a Mac, built from the same
# tag Windows downloads (b5130), since whisper.cpp publishes no Mac program.
# One file, linked statically, into vendor/whisper with whisper.cpp's licence,
# which the Mac build then carries inside the app.
#
#   scripts/build-whisper-mac.sh arm64      Apple Silicon, on the graphics chip (Metal)
#   scripts/build-whisper-mac.sh x86_64     Intel, on the processor
#   scripts/build-whisper-mac.sh universal  both, joined by lipo into one program
#                                           that runs on either chip (task 2682)
#
# Runs on a Mac with Xcode's command-line tools and cmake, as GitHub's macOS
# runners have. An Apple Silicon Mac builds either.
set -eu

ARCH="${1:?give the chip: arm64, x86_64 or universal}"
TAG=b5130
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/whisper"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Builds whisper-cli for one chip into $WORK/build-<chip>/bin/whisper-cli.
build_one() {
  case "$1" in
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
      echo "build-whisper-mac: no such chip: $1 (arm64, x86_64 or universal)" >&2
      exit 1
      ;;
  esac

  # shellcheck disable=SC2086
  cmake -S "$WORK/src" -B "$WORK/build-$1" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="$1" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$TARGET" \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_METAL="$METAL" \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_SERVER=OFF \
    $CPU_FLAGS
  cmake --build "$WORK/build-$1" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)"
}

case "$ARCH" in
  arm64 | x86_64 | universal) ;;
  *)
    echo "build-whisper-mac: no such chip: $ARCH (arm64, x86_64 or universal)" >&2
    exit 1
    ;;
esac

git clone --quiet --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$WORK/src"

rm -rf "$OUT"
mkdir -p "$OUT"
if [ "$ARCH" = universal ]; then
  build_one arm64
  build_one x86_64
  lipo -create "$WORK/build-arm64/bin/whisper-cli" "$WORK/build-x86_64/bin/whisper-cli" -output "$OUT/whisper-cli"
else
  build_one "$ARCH"
  cp "$WORK/build-$ARCH/bin/whisper-cli" "$OUT/whisper-cli"
fi
chmod 755 "$OUT/whisper-cli"
cp "$WORK/src/LICENSE" "$OUT/LICENSE"
echo "$TAG $ARCH" > "$OUT/build.txt"
file "$OUT/whisper-cli"
echo "build-whisper-mac: whisper-cli $TAG for $ARCH is in vendor/whisper"
