import type { ITheme } from "@xterm/xterm";

const KEY = "workdesk.theme";
export const DEFAULT_THEME = "Workdesk";

/** Name, background, foreground, cursor, selection, then the 16 ANSI colors (hex, no "#"), and an optional UI accent. */
type Row = [name: string, bg: string, fg: string, cursor: string, selection: string, ansi: string, accent?: string];

/** Made for Workdesk. */
const ORIGINALS: Row[] = [
  ["Workdesk", "0f1014", "d8dae0", "c5d0ff", "2f3a59", "1d1f27 ff6b7a 7ad48a f2c66d 7c9cff c59cff 62d6e8 d8dae0 5c6070 ff8e99 9be3a7 f7d58f a3baff d8bbff 8ae3f0 f4f5f8"],
  ["Workdesk Light", "f7f7f9", "2a2d36", "4a6cf0", "cfd9ff", "2a2d36 d83a4e 2f9a4a b07d12 4a6cf0 8a4fe0 1a96aa d9dbe2 7a7f8e ea5468 3db55c c99318 6585ff a46cf5 2bb0c4 f7f7f9"],
  ["Midnight Ink", "0a0d16", "c9d1ea", "8fa8ff", "222b4a", "151a2b f2667f 6fd3a2 f0c674 6f8dff a98bff 5cc8e6 c9d1ea 4a5272 ff8aa0 8ee6b9 f7d898 93acff c3abff 85dcf2 eef1fb"],
  ["Ember", "15100e", "ead9c8", "ff8a3d", "3a2a20", "241b17 f0614f 9fc06a f2b04c 7d9fc4 e07a9b e8a87c ead9c8 6b5a4e ff7f6b b6d487 ffc56b a0bedb f096b2 f5c09b fff4ea", "ff8a3d"],
  ["Glacier", "0c1418", "cfe3ea", "7fdcf0", "1f3a45", "16242b ef7a85 7fd4a8 e6cf8b 6fb4f0 b39cf0 6fdce8 cfe3ea 4b6470 ff9aa3 9fe6c2 f2dfa6 95caf7 cbb9f7 98e9f2 f2fafc", "6fdce8"],
  ["Moss", "11150f", "d6dcc6", "a8c97f", "2b3524", "1c2219 e07a6a a8c97f e3c27a 82a9c9 c49ac0 7fc4b0 d6dcc6 59634f f0978a c0dc9c efd59c a1c1dc d8b4d4 9cd9c7 f1f4e8", "a8c97f"],
  ["Sakura Night", "191317", "f0dde5", "ff8fb8", "3c2833", "261c22 ff6b8a 9fd8a0 f5c98a 8fb0f5 ff8fb8 8ad8d8 f0dde5 6e5763 ff8fa6 b8e8b9 fad9a8 adc6fa ffadcc a9e6e6 fff4f8", "ff8fb8"],
  ["Neon Tokyo", "0b0918", "e6e1ff", "ff4fd8", "2e2160", "1a1630 ff3d7f 3dffb0 ffe66d 4d9bff ff4fd8 3de8ff e6e1ff 5a527f ff6e9e 7affc9 fff09a 7ab5ff ff80e3 7af0ff ffffff", "ff4fd8"],
  ["Synth Sunset", "1a1022", "f6e2f0", "ff9e64", "40254f", "2a1a36 ff5f87 6af0b4 ffd36e 7aa2ff ff7edb 5ee6f0 f6e2f0 6e4f80 ff86a5 95f5c8 ffe196 9ebcff ffa2e6 8aedf5 fff6fb", "ff9e64"],
  ["Vapor", "1b1530", "eee4ff", "ff9de2", "3d2f66", "2a2147 ff7aa8 7af0c4 fff38a 8ab4ff c99bff 7ae8ff eee4ff 6a5c94 ff9cc0 9ff5d5 fff7ad a8c8ff d9b8ff 9ff0ff ffffff", "c99bff"],
  ["Deep Sea", "06121a", "c4dde6", "3fe0c5", "143444", "0e2230 f47c7c 3fe0c5 f5d76e 4aa8ff a68cff 2fc9e8 c4dde6 3e5a6b ff9b9b 72ecd6 f9e494 7cc0ff c1adff 66dcf2 eef8fb", "3fe0c5"],
  ["Desert Dusk", "1c1513", "ecd9c3", "e8a96b", "3d2c25", "2a201c d9715e a3b06f e8b56b 7f9db8 c2849e 85b5a8 ecd9c3 6e5b50 eb8d7a bcc68c f2ca8d 9db6cc d6a0b7 a2cbc0 fbf1e4", "e8a96b"],
  ["Espresso Crema", "1b1511", "e8d8c4", "d9a066", "3b2e24", "28201a d4705c 9cae6c d9a066 8ea3b5 b88a9e 8db3a3 e8d8c4 6b5a4b e38c78 b5c489 e6b886 a8bacb cda4b6 a8c9bb f8eee2", "d9a066"],
  ["Bloodmoon", "120a0b", "ecd6d6", "ff4d4d", "3a1a1c", "1f1213 ff4d4d 8cc084 e8b86b 8a9fd1 c78ab8 7fbfbf ecd6d6 664446 ff7a7a a8d3a1 f2cc8e a8b8e0 d9a6cc a0d3d3 fff2f2", "ff4d4d"],
  ["Solar Punk", "0f130b", "e2ecc8", "d4f04a", "2b3a17", "1a2113 ff7058 a8e05f d4f04a 6ec3e0 e58fd0 5fe0b0 e2ecc8 56653f ff917e c0ec85 e2f77a 92d4ea efadde 85ecc6 f8fdec", "d4f04a"],
  ["Graphite", "18181a", "d4d4d6", "ffffff", "3a3a3e", "232326 d77c7c 9cbf8a d4b97a 8fa6c4 b39ac4 8fbfbf d4d4d6 5f5f66 e89a9a b3d1a3 e3cc96 a9bcd6 c8b3d6 a9d1d1 f4f4f5", "c8c8cc"],
  ["OLED", "000000", "e6e6e6", "ffffff", "333333", "111111 ff5c5c 5cff8a ffd75c 5c9dff c77dff 5ce1ff e6e6e6 555555 ff8585 85ffa8 ffe285 85b6ff d6a0ff 85eaff ffffff"],
  ["High Contrast", "000000", "ffffff", "ffff00", "0040ff", "000000 ff3030 30ff30 ffff00 4080ff ff40ff 00ffff ffffff 808080 ff6060 60ff60 ffff60 70a0ff ff80ff 60ffff ffffff", "ffff00"],
  ["Paper", "f5f1e8", "2e2b26", "2e2b26", "ddd3bd", "2e2b26 b5412d 4d7f2a 9a6b0d 2f5f9a 86418a 2a7f7f d8cfbd 8a8273 cc5a44 64983f b8841c 4677b5 a05aa4 3d9999 f5f1e8"],
  ["Arctic", "eef3f7", "263540", "1f8fd6", "c8dceb", "263540 d6455d 2d9a6a b88a12 1f8fd6 8b5cd6 1599a8 d5e0e8 6b7f8e e85f75 42b082 d1a12a 3ea6ea a479ea 2db3c2 f7fafc"],
  ["Lavender Fog", "f4f1fa", "2f2940", "7c5cd6", "ddd3f5", "2f2940 d64a72 3f9a6e b0821a 5068d6 7c5cd6 2d94a8 e0dbec 7a7290 e86688 56b386 c99a30 6a82ea 9878ea 45adc0 fbfaff", "7c5cd6"],
  ["Mint", "f1f7f3", "23352b", "1e9e6a", "cbe8d8", "23352b cf4a4a 1e9e6a a8860f 3a78c9 a052b8 178f95 d8e6dd 6b8275 e26464 33b580 c09f25 5591dd b86ed0 2aa9ae f8fcf9", "1e9e6a"],
  ["Terracotta", "f8efe6", "3b2a22", "c4572e", "f0d4c0", "3b2a22 c4402e 5b8a3a a87412 3d6a99 9a4a7e 2f8585 e6d6c6 8a7365 d65c48 72a24f c38d26 5584b3 b56498 459e9e fdf8f3", "c4572e"],
];

/** Popular schemes, colors as published in mbadolato/iTerm2-Color-Schemes. */
const POPULAR: Row[] = [
  ["Afterglow", "212121", "d0d0d0", "d0d0d0", "303030", "151515 ac4142 7e8e50 e5b567 6c99bb 9f4e85 7dd6cf d0d0d0 505050 ac4142 7e8e50 e5b567 6c99bb 9f4e85 7dd6cf f5f5f5"],
  ["Alabaster", "f7f7f7", "000000", "007acc", "bfdbfe", "000000 aa3731 448c27 cb9000 325cc0 7a3e9d 0083b2 b7b7b7 777777 f05050 60cb00 f2af50 007acc e64ce6 00aacb f7f7f7"],
  ["Amber CRT", "1a1200", "ffb000", "ffb000", "3a2a00", "2a1e00 ff6a00 ffb000 ffc742 ff8c00 ffa033 ffd27f ffd9a0 6a4e00 ff8a1e ffc742 ffe08a ffab3d ffc266 ffe3b0 fff0d6"],
  ["Andromeda", "262a33", "e5e5e5", "f8f8f0", "5a5c62", "000000 cd3131 05bc79 e5e512 2472c8 bc3fbc 0fa8cd e5e5e5 666666 cd3131 05bc79 e5e512 2472c8 bc3fbc 0fa8cd e5e5e5"],
  ["Aura", "15141b", "edecee", "a277ff", "a277ff", "110f18 ff6767 61ffca ffca85 a277ff a277ff 61ffca edecee 4d4d4d ffca85 a277ff ffca85 a277ff a277ff 61ffca edecee"],
  ["Ayu", "0b0e14", "bfbdb6", "e6b450", "409fff", "11151c ea6c73 7fd962 f9af4f 53bdfa cda1fa 90e1c6 c7c7c7 686868 f07178 aad94c ffb454 59c2ff d2a6ff 95e6cb ffffff"],
  ["Ayu Light", "f8f9fa", "5c6166", "ffaa33", "035bd6", "000000 ea6c6d 6cbf43 eca944 3199e1 9e75c7 46ba94 bababa 686868 f07171 86b300 f2ae49 399ee6 a37acc 4cbf99 d1d1d1"],
  ["Ayu Mirage", "1f2430", "cccac2", "ffcc66", "409fff", "171b24 ed8274 87d96c facc6e 6dcbfa dabafa 90e1c6 c7c7c7 686868 f28779 d5ff80 ffd173 73d0ff dfbfff 95e6cb ffffff"],
  ["Belafonte Night", "20111b", "968c83", "968c83", "45373c", "20111b be100e 858162 eaa549 426a79 97522c 989a9c 968c83 5e5252 be100e 858162 eaa549 426a79 97522c 989a9c d5ccba"],
  ["Black Metal", "000000", "c1c1c1", "c1c1c1", "c1c1c1", "000000 486e6f dd9999 a06666 888888 999999 aaaaaa c1c1c1 404040 486e6f dd9999 a06666 888888 999999 aaaaaa c1c1c1"],
  ["Carbonfox", "161616", "f2f4f8", "f2f4f8", "2a2a2a", "282828 ee5396 25be6a 08bdba 78a9ff be95ff 33b1ff dfdfe0 484848 f16da6 46c880 2dc7c4 8cb6ff c8a5ff 52bdff e4e4e5"],
  ["Catppuccin Frappé", "303446", "c6d0f5", "f2d5cf", "f2d5cf", "51576d e78284 a6d189 e5c890 8caaee f4b8e4 81c8be b5bfe2 626880 eda0a2 b9dba2 ecd7ae adc2f3 f38ed8 98d2ca a5adce"],
  ["Catppuccin Latte", "eff1f5", "4c4f69", "dc8a78", "dc8a78", "bcc0cc d20f39 40a02b df8e1d 1e66f5 ea76cb 179299 5c5f77 acb0be e7103f 46b02f e49931 3878f6 ef95d7 19a1a8 6c6f85"],
  ["Catppuccin Macchiato", "24273a", "cad3f5", "f4dbd6", "f4dbd6", "494d64 ed8796 a6da95 eed49f 8aadf4 f5bde6 8bd5ca b8c0e0 5b6078 f2a7b2 bde3b0 f4e3c1 adc5f7 f493da a5ded6 a5adcb"],
  ["Catppuccin Mocha", "1e1e2e", "cdd6f4", "f5e0dc", "f5e0dc", "45475a f38ba8 a6e3a1 f9e2af 89b4fa f5c2e7 94e2d5 bac2de 585b70 f7aec2 c2ecbf fcd682 aeccfc f398da b1eae1 a6adc8"],
  ["Challenger Deep", "1e1c31", "cbe1e7", "fbfcfc", "cbe1e7", "141228 ff5458 62d196 ffb378 65b2ff 906cff 63f2f1 a6b3cc 565575 ff8080 95ffa4 ffe9aa 91ddff c991e1 aaffe4 cbe3e7"],
  ["Cobalt2", "132738", "ffffff", "f0cc09", "18354f", "000000 ff0000 38de21 ffe50a 1460d2 ff005d 00bbbb bbbbbb 555555 f40e17 3bd01d edc809 5555ff ff55ff 6ae3fa ffffff"],
  ["Cyberpunk", "332a57", "e5e5e5", "21f6bc", "c1deff", "000000 ff7092 00fbac fffa6a 00bfff df95ff 86cbfe ffffff 595959 ff8aa4 21f6bc fff787 1bccfd e6aefe 99d6fc ffffff"],
  ["Dawnfox", "faf4ed", "575279", "575279", "d0d8d8", "575279 b4637a 618774 ea9d34 286983 907aa9 56949f b2b6bd 5f5695 c26d85 629f81 eea846 2d81a3 9a80b9 5ca7b4 e6ebf3"],
  ["Doom One", "282c34", "bbc2cf", "51afef", "42444b", "000000 ff6c6b 98be65 ecbe7b a9a1e1 c678dd 51afef bbc2cf 595959 ff6655 99bb66 ecbe7b a9a1e1 c678dd 51afef bfbfbf"],
  ["Dracula", "282a36", "f8f8f2", "f8f8f2", "44475a", "21222c ff5555 50fa7b f1fa8c bd93f9 ff79c6 8be9fd f8f8f2 6272a4 ff6e6e 69ff94 ffffa5 d6acff ff92df a4ffff ffffff"],
  ["Dracula+", "212121", "f8f8f2", "eceff4", "f8f8f2", "21222c ff5555 50fa7b ffcb6b 82aaff c792ea 8be9fd f8f8f2 545454 ff6e6e 69ff94 ffcb6b d6acff ff92df a4ffff f8f8f2"],
  ["Duskfox", "232136", "e0def4", "e0def4", "433c59", "393552 eb6f92 a3be8c f6c177 569fba c4a7e7 9ccfd8 e0def4 544d8a f083a2 b1d196 f9cb8c 65b1cd ccb1ed a6dae3 e2e0f7"],
  ["Earthsong", "292520", "e5c7a9", "f6f7ec", "121418", "121418 c94234 85c54c f5ae2e 1398b9 d0633d 509552 e5c6aa 675f54 ff645a 98e036 e0d561 5fdaff ff9269 84f088 f6f7ec"],
  ["Embark", "1e1c31", "eeffff", "a1efd3", "fbfcfc", "1e1c31 f0719b a1efd3 ffe9aa 57c7ff c792ea 87dfeb f8f8f2 585273 f02e6e 2ce592 ffb378 1da0e2 a742ea 63f2f1 a6b3cc"],
  ["Espresso", "323232", "ffffff", "d6d6d6", "5b5b5b", "353535 d25252 a5c261 ffc66d 6c99bb d197d9 bed6ff eeeeec 606060 f00c0c c2e075 e1e48b 8ab7d9 efb5f7 dcf4ff ffffff"],
  ["Everblush", "141b1e", "dadada", "dadada", "141b1e", "232a2d e57474 8ccf7e e5c76b 67b0e8 c47fd5 6cbfbf b3b9b8 464e50 ef7e7e 96d988 f4d67a 71baf2 ce89df 67cbe7 bdc3c2"],
  ["Everforest Dark", "232a2e", "d3c6aa", "e69875", "543a48", "7a8478 e67e80 a7c080 dbbc7f 7fbbb3 d699b6 83c092 f2efdf a6b0a0 f85552 8da101 dfa000 3a94c5 df69ba 35a77c fffbef"],
  ["Everforest Light", "efebd4", "5c6a72", "f57d26", "eaedc8", "7a8478 e67e80 9ab373 c1a266 7fbbb3 d699b6 83c092 b2af9f a6b0a0 f85552 8da101 dfa000 3a94c5 df69ba 35a77c fffbef"],
  ["Fairyfloss", "5a5475", "f8f8f2", "f8f8f0", "8077a8", "040303 f92672 c2ffdf e6c000 c2ffdf ffb8d1 c5a3ff f8f8f0 6090cb ff857f c2ffdf ffea00 c2ffdf ffb8d1 c5a3ff f8f8f0"],
  ["Flexoki Dark", "100f0f", "cecdc3", "cecdc3", "403e3c", "100f0f d14d41 879a39 d0a215 4385be ce5d97 3aa99f 878580 575653 af3029 66800b ad8301 205ea6 a02f6f 24837b cecdc3"],
  ["Flexoki Light", "fffcf0", "100f0f", "100f0f", "cecdc3", "100f0f af3029 66800b ad8301 205ea6 a02f6f 24837b 6f6e69 b7b5ac d14d41 879a39 d0a215 4385be ce5d97 3aa99f cecdc3"],
  ["GitHub Dark", "0d1117", "e6edf3", "2f81f7", "e6edf3", "484f58 ff7b72 3fb950 d29922 58a6ff bc8cff 39c5cf b1bac4 6e7681 ffa198 56d364 e3b341 79c0ff d2a8ff 56d4dd ffffff"],
  ["GitHub Dark Dimmed", "22272e", "adbac7", "539bf5", "adbac7", "545d68 f47067 57ab5a c69026 539bf5 b083f0 39c5cf 909dab 636e7b ff938a 6bc46d daaa3f 6cb6ff dcbdfb 56d4dd cdd9e5"],
  ["GitHub Light", "ffffff", "1f2328", "0969da", "1f2328", "24292f cf222e 116329 4d2d00 0969da 8250df 1b7c83 6e7781 57606a a40e26 1a7f37 633c01 218bff a475f9 3192aa 8c959f"],
  ["Green Phosphor", "0b0f0b", "33ff33", "33ff33", "0a3a0a", "002200 00aa00 33ff33 66ff66 00cc44 00ff88 66ffaa b6ffb6 0a5a0a 19cc19 66ff66 99ff99 33ff77 66ffaa 99ffcc e6ffe6"],
  ["Gruvbox Dark", "282828", "ebdbb2", "ebdbb2", "665c54", "282828 cc241d 98971a d79921 458588 b16286 689d6a a89984 928374 fb4934 b8bb26 fabd2f 83a598 d3869b 8ec07c ebdbb2"],
  ["Gruvbox Dark Hard", "1d2021", "ebdbb2", "ebdbb2", "665c54", "1d2021 cc241d 98971a d79921 458588 b16286 689d6a a89984 928374 fb4934 b8bb26 fabd2f 83a598 d3869b 8ec07c ebdbb2"],
  ["Gruvbox Light", "fbf1c7", "3c3836", "3c3836", "3c3836", "fbf1c7 cc241d 98971a d79921 458588 b16286 689d6a 7c6f64 928374 9d0006 79740e b57614 076678 8f3f71 427b58 3c3836"],
  ["Gruvbox Material Dark", "282828", "d4be98", "d4be98", "d4be98", "282828 ea6962 a9b665 d8a657 7daea3 d3869b 89b482 d4be98 7c6f64 ea6962 a9b665 d8a657 7daea3 d3869b 89b482 ddc7a1"],
  ["Gruvbox Material Light", "fbf1c7", "654735", "654735", "654735", "fbf1c7 c14a4a 6c782e b47109 45707a 945e80 4c7a5d 654735 a89984 c14a4a 6c782e b47109 45707a 945e80 4c7a5d 4f3829"],
  ["Homebrew", "000000", "00ff00", "23ff18", "083905", "000000 990000 00a600 999900 0d0dbf b200b2 00a6b2 bfbfbf 666666 e50000 00d900 e5e500 0000ff e500e5 00e5e5 e5e5e5"],
  ["Horizon", "1c1e26", "d5d8da", "6c6f93", "6c6f93", "000000 e95678 29d398 fab795 26bbd9 ee64ac 59e1e3 e5e5e5 666666 ec6a88 3fdaa4 fbc3a7 3fc4de f075b5 6be4e6 e5e5e5"],
  ["Hybrid", "161719", "b7bcba", "b7bcba", "1e1f22", "2a2e33 b84d51 b3bf5a e4b55e 6e90b0 a17eac 7fbfb4 b5b9b6 434548 8d2e32 798431 e58a50 4b6b88 6e5079 4d7b74 5a626a"],
  ["Iceberg Dark", "161821", "c6c8d1", "c6c8d1", "c6c8d1", "1e2132 e27878 b4be82 e2a478 84a0c6 a093c7 89b8c2 c6c8d1 6b7089 e98989 c0ca8e e9b189 91acd1 ada0d3 95c4ce d2d4de"],
  ["Iceberg Light", "e8e9ec", "33374c", "33374c", "33374c", "dcdfe7 cc517a 668e3d c57339 2d539e 7759b4 3f83a6 33374c 8389a3 cc3768 598030 b6662d 22478e 6845ad 327698 262a3f"],
  ["Jellybeans", "121212", "dedede", "ffa560", "474e91", "929292 e27373 94b979 ffba7b 97bedc e1c0fa 00988e dedede bdbdbd ffa1a1 bddeab ffdca0 b1d8f6 fbdaff 1ab2a8 ffffff"],
  ["JetBrains Darcula", "202020", "adadad", "ffffff", "1a3272", "000000 fa5355 126e00 c2c300 4581eb fa54ff 33c2c1 adadad 555555 fb7172 67ff4f ffff00 6d9df1 fb82ff 60d3d1 eeeeee"],
  ["Kanagawa", "1f1f28", "dcd7ba", "dcd7ba", "dcd7ba", "090618 c34043 76946a c0a36e 7e9cd8 957fb8 6a9589 c8c093 727169 e82424 98bb6c e6c384 7fb4ca 938aa9 7aa89f dcd7ba"],
  ["Kanagawa Dragon", "181616", "c5c9c5", "c8c093", "c5c9c5", "0d0c0c c4746e 8a9a7b c4b28a 8ba4b0 a292a3 8ea4a2 c8c093 a6a69c e46876 87a987 e6c384 7fb4ca 938aa9 7aa89f c5c9c5"],
  ["Kanagawa Lotus", "f2ecbc", "545464", "43436c", "545464", "1f1f28 c84053 6f894e 77713f 4d699b b35b79 597b75 545464 8a8980 d7474b 6e915f 836f4a 6693bf 624c83 5e857a 43436c"],
  ["Kanso Zen", "090e13", "c5c9c7", "c5c9c7", "393b44", "0d0c0c c4746e 8a9a7b c4b28a 8ba4b0 a292a3 8ea4a2 c8c093 a4a7a4 e46876 87a987 e6c384 7fb4ca 938aa9 7aa89f c5c9c7"],
  ["Light Owl", "fbfbfb", "403f53", "403f53", "e0e0e0", "403f53 de3d3b 08916a e0af02 288ed7 d6438a 2aa298 bdbdbd 989fb1 de3d3b 08916a daaa01 288ed7 d6438a 2aa298 f0f0f0"],
  ["macOS Terminal", "1e1e1e", "ffffff", "98989d", "3f638b", "1a1a1a cc372e 26a439 cdac08 0869cb 9647bf 479ec2 98989d 464646 ff453a 32d74b ffd60a 0a84ff bf5af2 76d6ff ffffff"],
  ["Man Page", "fef49c", "000000", "7f7f7f", "a4c9cd", "000000 cc0000 00a600 999900 0000b2 b200b2 00a6b2 b2b2b2 666666 e50000 00cc00 bfbf00 0000ff e500e5 00cbcb e5e5e5"],
  ["Material Darker", "212121", "eeffff", "ffffff", "eeffff", "000000 ff5370 c3e88d ffcb6b 82aaff c792ea 89ddff ffffff 545454 ff5370 c3e88d ffcb6b 82aaff c792ea 89ddff ffffff"],
  ["Material Ocean", "0f111a", "8f93a2", "ffcc00", "1f2233", "546e7a ff5370 c3e88d ffcb6b 82aaff c792ea 89ddff ffffff 546e7a ff5370 c3e88d ffcb6b 82aaff c792ea 89ddff ffffff"],
  ["Matrix", "0f191c", "426644", "384545", "18282e", "0f191c 23755a 82d967 ffd700 3f5242 409931 50b45a 507350 688060 2fc079 90d762 faff00 4f7e7e 11ff25 c1ff8a 678c61"],
  ["Melange Dark", "292522", "ece1d7", "ece1d7", "ece1d7", "34302c bd8183 78997a e49b5d 7f91b2 b380b0 7b9695 c1a78e 867462 d47766 85b695 ebc06d a3a9ce cf9bc2 89b3b6 ece1d7"],
  ["Melange Light", "f1f1f1", "54433a", "54433a", "54433a", "e9e1db c77b8b 6e9b72 bc5c00 7892bd be79bb 739797 7d6658 a98a78 bf0021 3a684a a06d00 465aa4 904180 3d6568 54433a"],
  ["Mellow", "161617", "c9c7cd", "cac9dd", "2a2a2d", "27272a f5a191 90b99f e6b99d aca1cf e29eca ea83a5 c1c0d4 424246 ffae9f 9dc6ac f0c5a9 b9aeda ecaad6 f591b2 cac9dd"],
  ["Miasma", "222222", "c2c2b0", "c7c7c7", "e5c47b", "000000 685742 5f875f b36d43 78824b bb7744 c9a554 d7c483 666666 685742 5f875f b36d43 78824b bb7744 c9a554 d7c483"],
  ["Modus Operandi", "ffffff", "000000", "000000", "bdbdbd", "000000 a60000 006800 6f5500 0031a9 721045 005e8b a6a6a6 595959 972500 00663f 884900 3548cf 531ab6 005f5f 595959"],
  ["Modus Vivendi", "000000", "ffffff", "ffffff", "5a5a5a", "000000 ff5f59 44bc44 d0bc00 2fafff feacd0 00d3d0 a6a6a6 595959 ff7f9f 00c06f fec43f 79a8ff b6a0ff 6ae4b9 ffffff"],
  ["Monokai", "272822", "fdfff1", "c0c1b5", "57584f", "272822 f92672 a6e22e e6db74 fd971f ae81ff 66d9ef fdfff1 6e7066 f92672 a6e22e e6db74 fd971f ae81ff 66d9ef fdfff1"],
  ["Monokai Pro", "2d2a2e", "fcfcfa", "c1c0c0", "5b595c", "2d2a2e ff6188 a9dc76 ffd866 fc9867 ab9df2 78dce8 fcfcfa 727072 ff6188 a9dc76 ffd866 fc9867 ab9df2 78dce8 fcfcfa"],
  ["Monokai Pro Machine", "273136", "f2fffc", "b8c4c3", "545f62", "273136 ff6d7e a2e57b ffed72 ffb270 baa0f8 7cd5f1 f2fffc 6b7678 ff6d7e a2e57b ffed72 ffb270 baa0f8 7cd5f1 f2fffc"],
  ["Monokai Pro Octagon", "282a3a", "eaf2f1", "b2b9bd", "535763", "282a3a ff657a bad761 ffd76d ff9b5e c39ac9 9cd1bb eaf2f1 696d77 ff657a bad761 ffd76d ff9b5e c39ac9 9cd1bb eaf2f1"],
  ["Monokai Pro Ristretto", "2c2525", "fff1f3", "c3b7b8", "5b5353", "2c2525 fd6883 adda78 f9cc6c f38d70 a8a9eb 85dacc fff1f3 72696a fd6883 adda78 f9cc6c f38d70 a8a9eb 85dacc fff1f3"],
  ["Monokai Pro Spectrum", "222222", "f7f1ff", "bab6c0", "525053", "222222 fc618d 7bd88f fce566 fd9353 948ae3 5ad4e6 f7f1ff 69676c fc618d 7bd88f fce566 fd9353 948ae3 5ad4e6 f7f1ff"],
  ["Moonfly", "080808", "bdbdbd", "9e9e9e", "b2ceee", "323437 ff5454 8cc85f e3c78a 80a0ff cf87e8 79dac8 c6c6c6 949494 ff5189 36c692 c6c684 74b2ff ae81ff 85dc85 e4e4e4"],
  ["Neon", "14161a", "00fffc", "c7c7c7", "0013ff", "000000 ff3045 5ffa74 fffc7e 0f15d8 f924e7 00fffc c7c7c7 686868 ff5a5a 75ff88 fffd96 3c40cb f15be5 88fffe ffffff"],
  ["Night Owl", "011627", "d6deeb", "7e57c2", "5f7e97", "011627 ef5350 22da6e addb67 82aaff c792ea 21c7a8 ffffff 575656 ef5350 22da6e ffeb95 82aaff c792ea 7fdbca ffffff"],
  ["Nightfox", "192330", "cdcecf", "cdcecf", "2b3b51", "393b44 c94f6d 81b29a dbc074 719cd6 9d79d6 63cdcf dfdfe0 575860 d16983 8ebaa4 e0c989 86abdc baa1e2 7ad5d6 e4e4e5"],
  ["Nord", "2e3440", "d8dee9", "eceff4", "eceff4", "3b4252 bf616a a3be8c ebcb8b 81a1c1 b48ead 88c0d0 e5e9f0 596377 bf616a a3be8c ebcb8b 81a1c1 b48ead 8fbcbb eceff4"],
  ["Nord Light", "e5e9f0", "414858", "7bb3c3", "d8dee9", "3b4252 bf616a 96b17f c5a565 81a1c1 b48ead 7bb3c3 a5abb6 4c566a bf616a 96b17f c5a565 81a1c1 b48ead 82afae eceff4"],
  ["Nordfox", "2e3440", "cdcecf", "cdcecf", "3e4a5b", "3b4252 bf616a a3be8c ebcb8b 81a1c1 b48ead 88c0d0 e5e9f0 53648d d06f79 b1d196 f0d399 8cafd2 c895bf 93ccdc e7ecf4"],
  ["Novel", "dfdbc3", "3b2322", "73635a", "a4a390", "000000 cc0000 009600 d06b00 0000cc cc00cc 0087cc a6a6a6 808080 cc0000 009600 d06b00 0000cc cc00cc 0087cc ffffff"],
  ["Oceanic Next", "162c35", "c0c5ce", "c0c5ce", "4f5b66", "162c35 ec5f67 99c794 fac863 6699cc c594c5 5fb3b3 ffffff 65737e ec5f67 99c794 fac863 6699cc c594c5 5fb3b3 ffffff"],
  ["One Dark", "21252b", "abb2bf", "abb2bf", "323844", "21252b e06c75 98c379 e5c07b 61afef c678dd 56b6c2 abb2bf 767676 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 abb2bf"],
  ["One Half Dark", "282c34", "dcdfe4", "a3b3cc", "474e5d", "282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4 5d677a e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4"],
  ["One Half Light", "fafafa", "383a42", "a5b4e5", "bfceff", "383a42 e45649 50a14f c18401 0184bc a626a4 0997b3 bababa 4f525e e06c75 98c379 d8b36e 61afef c678dd 56b6c2 ffffff"],
  ["One Light", "f9f9f9", "2a2c33", "bbbbbb", "d0dffc", "000000 de3e35 3f953a d2b67c 2f5af3 950095 3f953a bbbbbb 000000 de3e35 3f953a d2b67c 2f5af3 a00095 3f953a ffffff"],
  ["Outrun Electric", "0c0a20", "f2f3f7", "ff2afc", "ba45a3", "131033 e61f44 a7da1e ffd400 1ea8fc ff2afc 42c6ff f2f3f7 546a90 ef6d85 c6e76d ffe359 6dc6fd df85ff 84daff ffffff"],
  ["Oxocarbon", "161616", "f2f4f8", "ffffff", "393939", "161616 00dfdb 00b4ff ff4297 00c15a c693ff ff74b8 f2f4f8 585858 00dfdb 00b4ff ff4297 00c15a c693ff ff74b8 f2f4f8"],
  ["Palenight", "3e4251", "cccccc", "ffcb6b", "717cb4", "000000 f07178 c3e88d ffcb6b 82aaff c792ea 89ddff ffffff 737373 f6a9ae dbf1ba ffdfa6 b4ccff ddbdf2 b8eaff 999999"],
  ["Paper Tiger", "fffaf0", "181818", "725000", "eadfc8", "2b2b29 861f1f 0d5b30 674b00 17468f 602f88 005968 3c3a35 4b4943 922525 106234 704f00 123a78 68368f 004a57 45433e"],
  ["Poimandres", "1a1e28", "a6accd", "ffffff", "a6accd", "1a1e28 d0679d 5de4c7 fffac2 89ddff fcc5e9 add7ff ffffff a6accd d0679d 5de4c7 fffac2 add7ff fae4fc 89ddff ffffff"],
  ["Raycast Dark", "1a1a1a", "ffffff", "cccccc", "333333", "000000 ff5360 59d499 ffc531 56c2ff cf2f98 52eee5 ffffff 4c4c4c ff6363 59d499 ffc531 56c2ff cf2f98 52eee5 ffffff"],
  ["Rebecca", "292a44", "e8e6ed", "b89bf9", "663399", "12131e dd7755 04dbb5 f2e7b7 7aa5ff bf9cf9 56d3c2 e4e3e9 666699 ff92cd 01eac0 fffca8 69c0fa c17ff8 8bfde1 f4f2f9"],
  ["Rosé Pine", "191724", "e0def4", "e0def4", "403d52", "26233a eb6f92 31748f f6c177 9ccfd8 c4a7e7 ebbcba e0def4 6e6a86 eb6f92 31748f f6c177 9ccfd8 c4a7e7 ebbcba e0def4"],
  ["Rosé Pine Dawn", "faf4ed", "575279", "575279", "dfdad9", "f2e9e1 b4637a 286983 ea9d34 56949f 907aa9 d7827e 575279 9893a5 b4637a 286983 ea9d34 56949f 907aa9 d7827e 575279"],
  ["Rosé Pine Moon", "232136", "e0def4", "e0def4", "44415a", "393552 eb6f92 3e8fb0 f6c177 9ccfd8 c4a7e7 ea9a97 e0def4 6e6a86 eb6f92 3e8fb0 f6c177 9ccfd8 c4a7e7 ea9a97 e0def4"],
  ["Selenized Dark", "103c48", "adbcbc", "adbcbc", "184956", "184956 fa5750 75b938 dbb32d 4695f7 f275be 41c7b9 adbcbc 72898f ff665c 84c747 ebc13d 58a3ff ff84cd 53d6c7 cad8d9"],
  ["Selenized Light", "fbf3db", "53676d", "53676d", "ece3cc", "ece3cc d2212d 489100 ad8900 0072d4 ca4898 009c8f 53676d 909995 cc1729 428b00 a78300 006dce c44392 00978a 3a4d53"],
  ["Shades Of Purple", "1e1d40", "ffffff", "fad000", "b362ff", "000000 d90429 3ad900 ffe700 6943ff ff2c70 00c5c7 c7c7c7 686868 f92a1c 43d426 f1d000 6871ff ff77ff 79e8fb ffffff"],
  ["Snazzy", "1e1f29", "ebece6", "e4e4e4", "81aec6", "000000 fc4346 50fb7c f0fb8c 49baff fc4cb4 8be9fe ededec 555555 fc4346 50fb7c f0fb8c 49baff fc4cb4 8be9fe ededec"],
  ["Solarized Dark", "002b36", "839496", "839496", "073642", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 335e69 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3"],
  ["Solarized Light", "fdf6e3", "657b83", "657b83", "eee8d5", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 bbb5a2 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3"],
  ["Sonokai", "2c2e34", "e2e2e3", "e2e2e3", "414550", "181819 fc5d7c 9ed072 e7c664 76cce0 b39df3 f39660 e2e2e3 7f8490 fc5d7c 9ed072 e7c664 76cce0 b39df3 f39660 e2e2e3"],
  ["Spacedust", "0a1e24", "ecf0c1", "708284", "0a385c", "6e5346 e35b00 5cab96 e3cd7b 0f548b e35b00 06afc7 f0f1ce 684c31 ff8a3a aecab8 ffc878 67a0ce ff8a3a 83a7b4 fefff1"],
  ["Spacegray", "20242d", "b3b8c3", "b3b8c3", "16181e", "000000 b04b57 87b379 e5c179 7d8fa4 a47996 85a7a5 b3b8c3 4c4c4c b04b57 87b379 e5c179 7d8fa4 a47996 85a7a5 ffffff"],
  ["Srcery", "1c1b19", "fce8c3", "fbb829", "fce8c3", "1c1b19 ef2f27 519f50 fbb829 2c78bf e02c6d 0aaeb3 baa67f 918175 f75341 98bc37 fed06e 68a8e4 ff5c8f 2be4d0 fce8c3"],
  ["Synthwave", "000000", "dad9c7", "19cde6", "19cde6", "000000 f6188f 1ebb2b fdf834 2186ec f85a21 12c3e2 ffffff 7f7094 f841a0 25c141 fdf454 2f9ded f97137 19cde6 ffffff"],
  ["Tailwind Dark", "262626", "e5e5e5", "e5e5e5", "475569", "404040 f87171 4ade80 facc15 38bdf8 e879f9 2dd4bf e5e5e5 a3a3a3 fca5a5 86efac fde047 7dd3fc f0abfc 5eead4 f5f5f5"],
  ["Tango Dark", "000000", "ffffff", "ffffff", "b5d5ff", "000000 cc0000 4e9a06 c4a000 3465a4 75507b 06989a d3d7cf 555753 ef2929 8ae234 fce94f 729fcf ad7fa8 34e2e2 eeeeec"],
  ["Terafox", "152528", "e6eaea", "e6eaea", "293e40", "2f3239 e85c51 7aa4a1 fda47f 5a93aa ad5c7c a1cdd8 ebebeb 4e5157 eb746b 8eb2af fdb292 73a3b7 b97490 afd4de eeeeee"],
  ["Tokyo Night", "1a1b26", "c0caf5", "c0caf5", "33467c", "15161e f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff a9b1d6 414868 f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff c0caf5"],
  ["Tokyo Night Day", "e1e2e7", "3760bf", "3760bf", "99a7df", "e9e9ed f52a65 587539 8c6c3e 2e7de9 9854f1 007197 6172b0 a1a6c5 f52a65 587539 8c6c3e 2e7de9 9854f1 007197 3760bf"],
  ["Tokyo Night Moon", "222436", "c8d3f5", "c8d3f5", "2d3f76", "1b1d2b ff757f c3e88d ffc777 82aaff c099ff 86e1fc 828bb8 444a73 ff757f c3e88d ffc777 82aaff c099ff 86e1fc c8d3f5"],
  ["Tokyo Night Storm", "24283b", "c0caf5", "c0caf5", "364a82", "1d202f f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff a9b1d6 4e5575 f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff c0caf5"],
  ["Tomorrow", "ffffff", "4d4d4c", "4d4d4c", "d6d6d6", "000000 c82829 718c00 eab700 4271ae 8959a8 3e999f bfbfbf 000000 c82829 718c00 eab700 4271ae 8959a8 3e999f ffffff"],
  ["Tomorrow Night", "1d1f21", "c5c8c6", "c5c8c6", "373b41", "000000 cc6666 b5bd68 f0c674 81a2be b294bb 8abeb7 ffffff 4c4c4c cc6666 b5bd68 f0c674 81a2be b294bb 8abeb7 ffffff"],
  ["Tomorrow Night 80s", "2d2d2d", "cccccc", "cccccc", "515151", "000000 f2777a 99cc99 ffcc66 6699cc cc99cc 66cccc ffffff 595959 f2777a 99cc99 ffcc66 6699cc cc99cc 66cccc ffffff"],
  ["Twilight", "141414", "ffffd4", "ffffff", "313131", "141414 c06d44 afb97a c2a86c 44474a b4be7c 778385 ffffd4 404040 de7c4c ccd88c e2c47e 5a5e62 d0dc8e 8a989b ffffd4"],
  ["Ubuntu", "300a24", "eeeeec", "bbbbbb", "b5d5ff", "2e3436 cc0000 4e9a06 c4a000 3465a4 75507b 06989a d3d7cf 555753 ef2929 8ae234 fce94f 729fcf ad7fa8 34e2e2 eeeeec"],
  ["Vague", "141415", "cdcdcd", "cdcdcd", "252530", "252530 d8647e 7fa563 f3be7c 6e94b2 bb9dbd aeaed1 cdcdcd 606079 e08398 99b782 f5cb96 8ba9c1 c9b1ca bebeda d7d7d7"],
  ["Vercel", "101010", "fafafa", "f32882", "005be7", "000000 fc0036 29a948 ffae00 006aff f32882 00ac96 feffff a8a8a8 ff8080 4be15d ffae00 49aeff f97ea8 00e4c4 fefefe"],
  ["Vesper", "101010", "ffffff", "acb1ab", "988049", "101010 f5a191 90b99f e6b99d aca1cf e29eca ea83a5 a0a0a0 7e7e7e ff8080 99ffe4 ffc799 b9aeda ecaad6 f591b2 ffffff"],
  ["VS Code Dark+", "1e1e1e", "cccccc", "ffffff", "3a3d41", "000000 cd3131 0dbc79 e5e510 2472c8 bc3fbc 11a8cd e5e5e5 666666 f14c4c 23d18b f5f543 3b8eea d670d6 29b8db e5e5e5"],
  ["Wombat", "171717", "dedacf", "bbbbbb", "453b39", "000000 ff615a b1e969 ebd99c 5da9f6 e86aff 82fff7 dedacf 4a4a4a f58c80 ddf88f eee5b2 a5c7ff ddaaff b7fff9 ffffff"],
  ["Xcode Dark", "292a30", "dfdfe0", "dfdfe0", "414453", "414453 ff8170 78c2b3 d9c97c 4eb0cc ff7ab2 b281eb dfdfe0 7f8c98 ff8170 acf2e4 ffa14f 6bdfff ff7ab2 dabaff dfdfe0"],
  ["Xcode Light", "ffffff", "262626", "262626", "b4d8fd", "b4d8fd d12f1b 3e8087 78492a 0f68a0 ad3da4 804fb8 262626 8a99a6 d12f1b 23575c 78492a 0b4f79 ad3da4 4b21b0 262626"],
  ["Zenbones Dark", "1c1917", "b4bdc3", "c4cacf", "3d4042", "1c1917 de6e7c 819b69 b77e64 6099c0 b279a7 66a5ad b4bdc3 4d4540 e8838f 8bae68 d68c67 61abda cf86c1 65b8c1 888f94"],
  ["Zenbones Light", "f0edec", "2c363c", "2c363c", "cbd9e3", "f0edec a8334c 4f6c31 944927 286486 88507d 3b8992 2c363c b5a7a0 94253e 3f5a22 803d1c 1d5573 7b3b70 2b747c 4f5e68"],
  ["Zenburn", "3f3f3f", "dcdccc", "73635a", "21322f", "4d4d4d 7d5d5d 60b48a f0dfaf 5d6d7d dc8cc3 8cd0d3 dcdccc 709080 dca3a3 c3bf9f e0cf9f 94bff3 ec93d3 93e0e3 ffffff"],
];

/** UI accents for popular schemes whose ANSI blue doesn't suit the chrome. */
const POPULAR_ACCENTS: Record<string, string> = {
  Matrix: "82d967",
  "Green Phosphor": "33ff33",
  "Amber CRT": "ffb000",
  Homebrew: "00ff00",
  "Black Metal": "dd9999",
  Vesper: "ffc799",
  Oxocarbon: "c693ff",
  Ubuntu: "e95420",
};

/** Tab group colors: the hue each keeps in every theme, and the ANSI color it borrows when the theme's is close to that hue. */
const GROUP_BASE: Record<string, [hex: string, ansi?: number]> = {
  blue: ["#7c9cff", 4],
  purple: ["#b48cff", 5],
  green: ["#6fd08c", 2],
  orange: ["#ff9f5a"],
  pink: ["#ff7eb6"],
  cyan: ["#5fd4e6", 6],
  yellow: ["#f2c66d", 3],
  red: ["#ff6b7a", 1],
  grey: ["#9a9eab"],
};
export type GroupColor = "blue" | "purple" | "green" | "orange" | "pink" | "cyan" | "yellow" | "red" | "grey";
export const GROUP_COLOR_NAMES = Object.keys(GROUP_BASE) as GroupColor[];

const GROUP_KEY = "workdesk.groupColor";

/** The color new tabs and tab groups start in. */
export function defaultColor(): GroupColor {
  try {
    const c = localStorage.getItem(GROUP_KEY);
    if (GROUP_COLOR_NAMES.includes(c as GroupColor)) return c as GroupColor;
  } catch {
    // Fall through to the first.
  }
  return GROUP_COLOR_NAMES[0];
}

export function setDefaultColor(color: GroupColor) {
  try {
    localStorage.setItem(GROUP_KEY, color);
  } catch {
    // Not remembered past this session.
  }
}

export interface Theme {
  name: string;
  original: boolean;
  light: boolean;
  bg: string;
  fg: string;
  accent: string;
  danger: string;
  /** 16 ANSI colors, normal then bright. */
  ansi: string[];
  /** Tab group colors tuned to this theme. */
  groups: Record<GroupColor, string>;
  term: ITheme;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16)) as Rgb;
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function alpha(hex: string, a: number) {
  return `rgba(${rgb(hex).join(", ")}, ${a})`;
}

type Hsl = [h: number, s: number, l: number];
function toHsl(hex: string): Hsl {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function fromHsl([h, s, l]: Hsl) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * The nine group colors for a theme, and which of them is its UI accent. Each
 * keeps its own hue so groups stay told apart, takes the theme's ANSI color
 * when that's near the same hue, and otherwise takes on the theme's typical
 * saturation and lightness. The group nearest the theme's intended accent
 * becomes that accent, and its neighbors step aside around the wheel. Then
 * each is pushed lighter or darker until it reads against the background.
 */
function groupColors(bg: string, fg: string, ansi: string[], accent: string, light: boolean) {
  // Light themes' bright colors are often too pale to read, so use the normal ones there.
  const palette = ansi.slice(light ? 1 : 9, light ? 7 : 15).map(toHsl);
  const chromatic = palette.filter(([, s]) => s > 0.2);
  const s = chromatic.length ? median(chromatic.map((c) => c[1])) : 0.6;
  const l = chromatic.length ? median(chromatic.map((c) => c[2])) : light ? 0.45 : 0.7;
  const readable = (hsl: Hsl): string => {
    const c: Hsl = [...hsl];
    for (let i = 0; i < 40 && contrast(fromHsl(c), bg) < 3; i++) c[2] = Math.max(0, Math.min(1, c[2] + (light ? -0.02 : 0.02)));
    return fromHsl(c);
  };
  // The chromatic groups in hue order around the wheel.
  const ring = GROUP_COLOR_NAMES.filter((n) => n !== "grey")
    .map((n) => [n, toHsl(GROUP_BASE[n][0])[0]] as const)
    .sort((x, y) => x[1] - y[1]);
  const picked = {} as Record<GroupColor, Hsl>;
  for (const [name, hue] of ring) {
    const slot = GROUP_BASE[name][1];
    const own = slot != null ? palette[slot - 1] : undefined;
    // Borrow only a hue near this color's and clear of its neighbors', so yellow never passes for orange.
    const fits =
      own != null &&
      own[1] > 0.2 &&
      hueGap(own[0], hue) <= (name === "green" ? 30 : 15) &&
      ring.every(([other, h]) => other === name || hueGap(own[0], h) >= 12);
    picked[name] = fits ? own : [hue, Math.max(s, 0.35), l];
  }
  const [gh, gs, gl] = toHsl(mixHex(fg, bg, 0.6));
  picked.grey = [gh, Math.min(gs, 0.12), gl];

  const a = toHsl(accent);
  let anchor: GroupColor = "grey";
  if (a[1] > 0.2) {
    // Sky blues read as blue, not cyan, so they claim the blue group.
    const i =
      a[0] >= 195 && a[0] <= 250
        ? ring.findIndex(([n]) => n === "blue")
        : ring.reduce((best, [, h], j) => (hueGap(a[0], h) < hueGap(a[0], ring[best][1]) ? j : best), 0);
    anchor = ring[i][0];
    // Push neighbors on each side that crowd the accent, and theirs in turn.
    for (const dir of [1, -1]) {
      let prev = a[0];
      for (let k = 1; k < ring.length / 2; k++) {
        const hsl = picked[ring[(i + dir * k + ring.length) % ring.length][0]];
        if ((((hsl[0] - prev) * dir) % 360 + 360) % 360 >= 15) break;
        hsl[0] = (prev + dir * 15 + 360) % 360;
        prev = hsl[0];
      }
    }
  }
  picked[anchor] = a;

  const groups = {} as Record<GroupColor, string>;
  for (const name of GROUP_COLOR_NAMES) groups[name] = readable(picked[name]);
  return { groups, accent: groups[anchor] };
}
function mixHex(a: string, b: string, t: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((c, i) => Math.round(c * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

function build([name, bg, fg, cursor, selection, ansiStr, accent]: Row, original: boolean): Theme {
  const ansi = ansiStr.split(" ").map((c) => "#" + c);
  const h = (c: string) => "#" + c;
  const light = luminance(h(bg)) > 0.35;
  // The UI accent is always one of the group colors, the one nearest the scheme's own accent.
  const tuned = groupColors(h(bg), h(fg), ansi, h(accent ?? POPULAR_ACCENTS[name] ?? ansiStr.split(" ")[4]), light);
  const accentHex = tuned.accent;
  // Some schemes' selection hides the text on it; fall back to a tint of the accent.
  const sel = contrast(h(selection), h(fg)) < 2 ? alpha(accentHex, 0.3) : h(selection);
  const [black, red, green, yellow, blue, magenta, cyan, white] = ansi;
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ansi.slice(8);
  return {
    name,
    original,
    light,
    bg: h(bg),
    fg: h(fg),
    accent: accentHex,
    danger: red,
    ansi,
    groups: tuned.groups,
    term: {
      background: h(bg),
      foreground: h(fg),
      cursor: h(cursor),
      cursorAccent: h(bg),
      selectionBackground: sel,
      black, red, green, yellow, blue, magenta, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
    },
  };
}

export const THEMES: Theme[] = [...ORIGINALS.map((r) => build(r, true)), ...POPULAR.map((r) => build(r, false))];
const BY_NAME = new Map(THEMES.map((t) => [t.name, t]));

let current = BY_NAME.get(DEFAULT_THEME)!;
const listeners = new Set<(t: Theme) => void>();

export function currentTheme() {
  return current;
}

/** Called with the new theme whenever it changes. */
export function onThemeChange(fn: (t: Theme) => void) {
  listeners.add(fn);
}

/** Paints the app chrome in `theme`, tells listeners (the terminals), and remembers it. */
export function setTheme(theme: Theme) {
  current = theme;
  paint(theme);
  try {
    localStorage.setItem(KEY, theme.name);
  } catch {
    // Not remembered, but still applied.
  }
  for (const fn of listeners) fn(theme);
}

/** Applies the saved theme; call before anything renders. */
export function loadTheme() {
  let name: string | null = null;
  try {
    name = localStorage.getItem(KEY);
  } catch {
    // Default it is.
  }
  current = (name && BY_NAME.get(name)) || current;
  paint(current);
}

function paint(t: Theme) {
  const mix = (pct: number, base = t.bg) => `color-mix(in srgb, ${t.fg} ${pct}%, ${base})`;
  const vars: Record<string, string> = {
    "--bg": t.bg,
    "--text": t.fg,
    "--sidebar": mix(t.light ? 4 : 3.5),
    "--raised": t.light ? mix(1.5) : mix(7),
    "--sunken": t.light ? mix(3.5) : `color-mix(in srgb, ${t.bg} 70%, #000)`,
    "--muted": mix(58),
    "--faint": mix(38),
    "--accent": t.accent,
    "--on-accent": luminance(t.accent) > 0.3 ? "#0f1014" : "#ffffff",
    "--danger": t.danger,
    "--shadow-k": t.light ? "0.35" : "1",
  };
  for (const name of GROUP_COLOR_NAMES) vars[`--group-${name}`] = t.groups[name];
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) style.setProperty(k, v);
  style.colorScheme = t.light ? "light" : "dark";
}
