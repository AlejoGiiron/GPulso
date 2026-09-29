import { describe, expect, it } from 'vitest'
import { receiptHeaderNames } from './receiptHeader'

describe('receiptHeaderNames', () => {
  it('muestra el negocio como título y la tienda como subtítulo', () => {
    expect(receiptHeaderNames('CelFashion', 'CelFashion — Principal')).toEqual({
      title: 'CelFashion',
      subtitle: 'CelFashion — Principal',
    })
  })

  it('cae al nombre de la tienda mientras la organización no carga', () => {
    expect(receiptHeaderNames('', 'CelFashion — Principal')).toEqual({
      title: 'CelFashion — Principal',
      subtitle: null,
    })
    expect(receiptHeaderNames(undefined, 'Tienda')).toEqual({ title: 'Tienda', subtitle: null })
  })

  it('no repite la tienda cuando se llama igual que el negocio', () => {
    expect(receiptHeaderNames('CelFashion', ' CelFashion ')).toEqual({
      title: 'CelFashion',
      subtitle: null,
    })
  })

  it('sin tienda solo muestra el negocio', () => {
    expect(receiptHeaderNames(' CelFashion ', '')).toEqual({ title: 'CelFashion', subtitle: null })
  })

  it('nunca devuelve el texto fijo heredado', () => {
    const { title, subtitle } = receiptHeaderNames('CelFashion', 'CelFashion — Principal')
    expect(`${title} ${subtitle}`).not.toMatch(/g-?mura/i)
  })
})
