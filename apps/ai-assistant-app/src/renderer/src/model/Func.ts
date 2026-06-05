// Func to obiekt wartości reprezentujący funkcję/metodę encji. Niezmienny,
// z zachowaniem domenowym (sygnatura). Pozwala później rozbudować o parametry
// czy typ zwracany bez zmiany interfejsu Node.
export class Func {
  private constructor(private readonly _name: string) {}

  static of(name: string): Func {
    return new Func((name ?? '').trim())
  }

  get name(): string {
    return this._name
  }

  signature(): string {
    return `${this._name}()`
  }

  toString(): string {
    return this.signature()
  }
}
