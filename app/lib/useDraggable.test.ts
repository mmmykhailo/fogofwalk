import { expect, test } from "bun:test"
import {
  constrainDraggablePosition,
  getInitialDraggablePosition,
} from "./useDraggable"

test("useDraggable uses negative initial coordinates as far-edge offsets", () => {
  expect(
    getInitialDraggablePosition(
      { x: -16, y: -24 },
      {
        width: 320,
        height: 200,
        viewportWidth: 1_024,
        viewportHeight: 768,
        padding: 0,
      }
    )
  ).toEqual({ x: 688, y: 544 })
})

test("useDraggable uses padding when Infinity aligns an element with a far edge", () => {
  expect(
    getInitialDraggablePosition(
      { x: Infinity, y: 0 },
      {
        width: 320,
        height: 200,
        viewportWidth: 1_024,
        viewportHeight: 768,
        padding: 12,
      }
    )
  ).toEqual({ x: 692, y: 12 })
})

test("useDraggable keeps a dragged element within every padded viewport edge", () => {
  const bounds = {
    width: 320,
    height: 200,
    viewportWidth: 1_024,
    viewportHeight: 768,
    padding: 16,
  }

  expect(constrainDraggablePosition({ x: -100, y: -100 }, bounds)).toEqual({
    x: 16,
    y: 16,
  })
  expect(constrainDraggablePosition({ x: 900, y: 700 }, bounds)).toEqual({
    x: 688,
    y: 552,
  })
})

test("useDraggable re-clamps when the viewport becomes smaller", () => {
  expect(
    constrainDraggablePosition(
      { x: 688, y: 552 },
      {
        width: 320,
        height: 200,
        viewportWidth: 640,
        viewportHeight: 480,
        padding: 16,
      }
    )
  ).toEqual({ x: 304, y: 264 })
})

test("useDraggable re-clamps when the draggable element grows", () => {
  expect(
    constrainDraggablePosition(
      { x: 688, y: 552 },
      {
        width: 480,
        height: 360,
        viewportWidth: 1_024,
        viewportHeight: 768,
        padding: 16,
      }
    )
  ).toEqual({ x: 528, y: 392 })
})
