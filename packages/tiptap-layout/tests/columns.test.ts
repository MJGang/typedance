import { describe, expect, it } from "vitest"
import { Columns } from "../src/columns"
import { Column } from "../src/column"

describe("@typedance/tiptap-layout", () => {
  it("exports columns and column nodes", () => {
    expect(Columns.name).toBe("columns")
    expect(Column.name).toBe("column")
  })
})
