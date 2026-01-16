# Battlezone
Built a real-time WebGL tank game using the GPU rasterization pipeline with custom GLSL vertex/fragment shaders. The renderer uses model–view–projection (MVP) transforms, depth testing for correct occlusion, and a directional light with ambient + Lambertian diffuse shading (flat-shaded via per-face normals). Assets are loaded from OBJ files, triangulated, and uploaded to GPU vertex buffers alongside procedurally generated ground/obstacle meshes. Implemented a third-person chase camera plus mouse aiming via unprojecting screen-space to a world-space ray and intersecting the ground plane. Also added a mini-map “radar” by rendering the scene a second time in a separate viewport with a top-down orthographic projection.

--

This is a modern 3D version of Battle Zone programmed in WebGL. Use these controls to control your tank and hit enemies:

W: Move forwards
S: Move backwards
A: Rotate left
D: Rotate right
Space/Mouse click: Shoot bullet
Mouse: Aim/rotate turret

Mountains are impassable objects, but hills are able to be driven over. Check the radar to see the location of your enemies and move appropriately. 

Upon being hit by an enemy, your score is reset. Try to get a highscore! 

Press (!) to access an alternate game mode: Spaceship Battle Zone. This game mode features spaceships & asteroids rather than mountains and tanks. The same game rules apply, but these are the new controls:

W: Move forwards
S: Move backwards
A: Move left
D: Move right
Q: Move up
E: Move down
Space/Mouse click: Shoot bullet
Mouse: Aim ship

I have implemented the following additional features:
- Track and display score.
- Add a "third-person" view, with the camera attached to the back of the player's tank.
- 3D gameplay: a field of play with different elevations, rotating turrets, and cannons that can be rotated with up/down and left/right.
- Minimap/radar display.
