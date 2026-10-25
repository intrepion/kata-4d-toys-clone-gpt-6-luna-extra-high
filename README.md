# Fourth Room

## Play online

[Play Fourth Room](https://intrepion.github.io/kata-4d-toys-clone-gpt-6-luna-extra-high/) — free, playable in your browser.

Fourth Room is a small, browser-based 4D toybox: rotate a shape through the fourth spatial axis, move a three-dimensional slice through it, then drag and toss it around the room.

It is an independent, original implementation inspired by the broad idea of playing with cross-sections of higher-dimensional objects. It does not use assets or code from *4D Toys* by mtb design works.

## Run it

Open `index.html` directly, or serve this directory with any static web server. For example:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Play

- Choose a hypercube, hypersphere, 5-cell, or 16-cell.
- Move the **Slice Position** slider to travel along `w`; the shape you see is the current 3D section.
- Turn the shape in the `xw` and `yw` planes, or leave auto-rotate on.
- Drag a toy to pick it up and throw it. Drag the empty background to orbit the view.
- Add toys, pause the motion with **Space**, toggle gravity, zoom with the wheel or `+`/`−`, and reset the view with the corner button.
- Use the arrow keys to move the slice; hold **Shift** for larger steps.

The polytopes are built from four-dimensional vertices, edges, and facets, then intersected with the active `w = constant` hyperplane. The hypersphere uses its analytic section radius `sqrt(r² − w²)`. Motion uses a lightweight 4D position with floor and boundary bounces; it is a playful visualization, not a general purpose 4D rigid-body solver.
