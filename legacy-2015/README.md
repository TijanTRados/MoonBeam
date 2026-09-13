# The original — MoonBeam, 2015

The Android app submitted with *Izrada interaktivne računalne igre za mobilne
uređaje* (Završni rad br. 4106, FER, University of Zagreb, June 2015).

Kept here unchanged, because the rebuild in `../src` is a continuation of this
project rather than a replacement for it.

## What is here

`app/src/main/java/com/tijantrados/moonbeam/` — nine `LEVEL*.java` activities,
a level picker, a loading screen, and the model classes `beam`, `field`,
`moon` and `finish`. The res/ folder holds the nine level layouts and the
periwinkle backgrounds.

## What to look at

The design lives in the comments, not the code. `LEVEL1.java`'s
`animationStart()` holds the main loop in Croatian pseudocode:

```
Zaključani = 0;
Dok (prijemnici otključani i postoji živa loptica i odbrojavanje > 0) {
   Za svaku lopticu koja postoji {
      Loptica.pomakni();
      ...
```

and `beam`, `field` and `moon` declare the attributes the thesis specifies —
`direction`, `color`, `life`, `value` — with the methods left as stubs. That
specification is what the current engine implements; `../src/engine/simulate.ts`
is that loop, written out.

## Building it

It targets Android Gradle Plugin 1.2 and `android.support.v7.ActionBarActivity`,
both long since removed, so it will not build against a modern SDK without
updating. It is here to be read.
