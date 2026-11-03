Stageshow runtime subset

Source: https://github.com/benjitaylor/skills/tree/802057409787133703c56001080169e347305572/stageshow
Copyright 2026 Benji Taylor. MIT license retained in LICENSE.

Includes only the scene, cursor, measurement, window, field, row and state-transition components and their dependencies. No external brand registry, app icons, example artwork, package scripts, or recording tools are included. Existing Hire Line Dancers artwork is loaded locally. No new npm dependencies were added.

Local adaptations:
- index.ts exposes only the imports used by InstructorDemo.
- stage.tsx uses explicit if/else for visibility callbacks to satisfy the host lint rules.
- stage.tsx reruns its playback effect when the poster prop changes so sequential static step selections show their selected state.

The source was reviewed for network calls, storage, credential access, dynamic code execution and installation scripts before use. The included runtime only manages local React state, browser measurements and animation.
