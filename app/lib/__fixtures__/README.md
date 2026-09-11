# Track smoothing fixtures

GPX test data for `trackSmoothing.test.ts`. Nothing imports these files, so
they never reach a bundle; the test reads them from disk. They live under
`app/` because the test does, and the `__fixtures__` name is what marks them as
test-only inside application source. The fixtures under `e2e/fixtures` are not
a precedent for putting them there: `e2e/` is an independent package with its
own tsconfig, and every file in that tree is already test code.

## What each one holds

| File                             | Artefact                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `excursion-after-a-pause.gpx`    | The fix is lost, returns 27 km away across a nine-minute gap, and snaps back in 59 seconds. |
| `excursion-across-the-globe.gpx` | A lost fix puts three points 6680 km out before the track resumes 1.5 km along.             |
| `spike-on-the-final-point.gpx`   | A spike on the last point alone, the one shape the recorded routes did not contain.         |

Each is roughly 400 points cut from a real Apple Health export around one
artefact. Recorded geometry is what exposed these bugs, and no synthetic track
reproduces the way a receiver loses and regains a fix.

## How they were made

Take a window of a few hundred points centred on the artefact, then translate
every coordinate so the first point lands on 52.5, 13.4 and re-base every
timestamp so the first point sits at 2024-01-01T08:00:00Z. Translating keeps
the shape, the distances and the time gaps that the filter reads, while
dropping the contributor's home location and the real dates. Write six decimal
places, one decimal of elevation, and no extensions.

`spike-on-the-final-point.gpx` needed two further changes, both deliberate.
Its final point was displaced by 0.02 degrees of latitude, because none of the
301 recorded routes contains a terminal spike; the rest of that track is
untouched. And it is serialized with `lat` before `lon`, the order Garmin and
gpx.studio emit, so the loader is exercised against both attribute orders
rather than only the Apple Health one.

Every fixture must start at 52.5, 13.4. The loader asserts it, which is what
stops a reversed, empty or zero-filled read from passing as a plausible track.
