declare module '@mapbox/polyline' {
  const polyline: {
    encode: (coordinates: [number, number][], precision?: number) => string
    decode: (str: string, precision?: number) => [number, number][]
  }
  export default polyline
}
