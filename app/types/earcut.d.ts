declare module "earcut" {
  export default function earcut(
    data: number[],
    holeIndices?: number[] | null,
    dim?: number
  ): number[]
}
