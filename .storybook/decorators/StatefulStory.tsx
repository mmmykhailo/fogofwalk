import { useCallback, useEffect, useState } from "react"

export interface StatefulStoryProps<Value> {
  initialValue: Value
  onChange?: (value: Value) => void
  children: (value: Value, setValue: (value: Value) => void) => React.ReactNode
}

/** Small controlled-prop harness shared by stories for stateful primitives. */
export function StatefulStory<Value>({
  initialValue,
  onChange,
  children,
}: StatefulStoryProps<Value>) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const update = useCallback(
    (nextValue: Value) => {
      setValue(nextValue)
      onChange?.(nextValue)
    },
    [onChange]
  )

  return children(value, update)
}
