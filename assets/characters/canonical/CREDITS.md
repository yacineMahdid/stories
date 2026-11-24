# Canonical base: credits

Body mesh: "Animal Crossing Player Model" by SSlamon, licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/).
Source: https://sketchfab.com/3d-models/animal-crossing-player-model-701a20b9786740378c2d67df3d810ef8

`source/AC_Player_Base.obj` is the original mesh. `base.gltf` is derived from it by
`tools/build_base.py`: rescaled to 1 unit tall, subdivided once, smoothed, rigged with
the canonical skeleton, skin-weighted, and given a face layer.
