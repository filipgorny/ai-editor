// Route to obiekt wartości (value object) reprezentujący ścieżkę kontrolera.
// Niezmienny, porównywany przez wartość.
export class Route {
  private constructor(private readonly value: string) {}

  static of(value: string): Route {
    return new Route((value ?? '').trim())
  }

  static none(): Route {
    return new Route('')
  }

  isEmpty(): boolean {
    return this.value === ''
  }

  equals(other: Route): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.isEmpty() ? '' : `/${this.value}`
  }
}
