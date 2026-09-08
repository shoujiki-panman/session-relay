#!/bin/bash

# Raycast Script Command。
# Raycast → Extensions → Script Commands → Add Script Directory でこの examples/raycast を
# 登録すると、「印」と打つだけで最後に話していた会話に印がつく。
#
# @raycast.schemaVersion 1
# @raycast.title この会話に印をつける
# @raycast.mode compact
# @raycast.icon 📌
# @raycast.packageName session-relay
# @raycast.description 最後に動いていた会話に「次はこれ」の印をつける。新しいセッションで「続きから」と言えばそれが読まれる

# Raycastはカレントディレクトリを持たないので --recent（場所を問わず最後の会話）を使う。
#
# PATHも限られている。実測: Raycast相当のPATH（/usr/bin:/bin:/usr/sbin:/sbin）では
# **node が見つからない**ので relay は起動しない。node の置き場を足しておく。
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

exec "$HOME/.local/bin/relay" mark --recent
