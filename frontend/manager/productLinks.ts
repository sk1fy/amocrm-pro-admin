import type { Product } from './productsApi'

function productLinkKind(label: string) {
  switch (label.trim().toLowerCase()) {
    case 'установка':
    case 'установить':
    case 'ссылка на установку':
      return 'installation'
    case 'инструкция':
    case 'документация':
      return 'instruction'
    default:
      return 'other'
  }
}

export function separateProductLinks(links: Product['links']) {
  const installation = links.find((link) => productLinkKind(link.label) === 'installation')
  const instruction = links.find((link) => productLinkKind(link.label) === 'instruction')
  return {
    installation,
    instruction,
    other: links.filter((link) => link !== installation && link !== instruction),
  }
}
