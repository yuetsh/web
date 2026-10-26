/**
 * 与 Python 的 round(x, n) 结果一致：按浮点数的精确值舍入，正好在中间时取偶数（银行家舍入）。
 * Number#toFixed 同样按精确值舍入，只是“正好在中间”时向上取，所以只需单独处理这种情况。
 * 十进制 n 位小数的精确中点必然形如 奇数 / 2^(n+1)，据此判断。
 */
export function pyRound(x: number, ndigits = 0): number {
  const t = x * 2 ** (ndigits + 1)
  if (Number.isInteger(t) && Math.abs(t) % 2 === 1) {
    const scale = 10 ** ndigits
    const floor = Math.floor(x * scale)
    return (floor % 2 === 0 ? floor : floor + 1) / scale
  }
  return Number(x.toFixed(ndigits))
}

/** 与 Python 3.12+ 的 sum() 一致：对浮点数做 Neumaier 补偿求和 */
export function pySum(values: Iterable<number>): number {
  let sum = 0
  let c = 0
  for (const x of values) {
    const t = sum + x
    if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x
    else c += x - t + sum
    sum = t
  }
  return c && Number.isFinite(c) ? sum + c : sum
}
