#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux || { echo 'Run inside WSL2 Ubuntu/Linux'; exit 1; }
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev libudev-dev curl ca-certificates git clang cmake protobuf-compiler
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.89.0 --profile minimal
fi
source "$HOME/.cargo/env"
rustup toolchain install 1.89.0 --profile minimal --component rustfmt
rustup default 1.89.0
# AVM's released lockfile includes cargo-platform 0.3.3 (MSRV 1.91).
# Bootstrap AVM with 1.91; host contract tests remain explicitly on 1.89.
rustup toolchain install 1.91.0 --profile minimal
cargo +1.91.0 install --git https://github.com/otter-sec/anchor --tag v1.1.2 avm --locked
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
avm install 1.1.2
avm use 1.1.2
sh -c "$(curl -sSfL https://release.anza.xyz/v4.1.2/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Node 24 LTS from the official distribution, checked against its published checksum.
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) echo 'Unsupported Node architecture'; exit 1 ;;
esac
node_temp=$(mktemp -d)
curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$node_temp/SHASUMS256.txt"
node_archive=$(awk -v arch="$node_arch" '$2 ~ "linux-" arch "\\.tar\\.xz$" { print $2 }' "$node_temp/SHASUMS256.txt")
test -n "$node_archive"
curl -fsSL "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "$node_temp/$node_archive"
(cd "$node_temp"; awk -v file="$node_archive" '$2 == file' SHASUMS256.txt | sha256sum -c -)
node_directory="$HOME/.local/share/hunch/node24"
mkdir -p "$node_directory"
tar -xJf "$node_temp/$node_archive" --strip-components=1 -C "$node_directory"
export PATH="$node_directory/bin:$PATH"
printf '\nAdd these paths to your shell configuration:\n'
printf 'export PATH="$HOME/.local/share/hunch/node24/bin:$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"\n'
rustc --version
anchor --version
solana --version
cargo-build-sbf --version
node --version
# No key generation, airdrop, deploy, upgrade, or global RPC/keypair configuration.
