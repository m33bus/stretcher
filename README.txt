HEAD STRETCH SITE — GITHUB PAGES SCAFFOLD

DROP-IN FILE STRUCTURE

head_stretch_site/
  index.html
  style.css
  app.js
  assets/
    background.jpg
    head.glb

WHAT TO DO
1. Replace assets/head.glb with your own head model.
2. Keep the exact file name: head.glb
3. Upload everything to the root of your GitHub Pages repo.
4. Make sure index.html stays in the root, not inside another folder.

HOW IT WORKS
- Drag empty space to rotate around the head.
- Drag directly on the head mesh to stretch it.
- The deformation stays until you hit reset.

NOTES
- Best with a static GLB head mesh.
- If your GLB contains many meshes, the largest mesh is chosen as the stretchy one.
- This uses online Three.js module imports, so GitHub Pages is fine.
