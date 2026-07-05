import type { Commodity, CommodityCategory } from '@/types'

/**
 * Commodities that commonly appear in Star Citizen hauling missions
 * (Star Citizen Wiki / observed contracts). Players can type any name in a
 * mission anyway — this list just powers autocomplete and category coloring.
 */
export const COMMODITIES: Commodity[] = [
  { name: 'Aluminum', category: 'Metal' },
  { name: 'Titanium', category: 'Metal' },
  { name: 'Copper', category: 'Metal' },
  { name: 'Iron', category: 'Metal' },
  { name: 'Tungsten', category: 'Metal' },
  { name: 'Gold', category: 'Metal' },
  { name: 'Agricium', category: 'Metal' },
  { name: 'Laranite', category: 'Mineral' },
  { name: 'Cobalt', category: 'Mineral' },
  { name: 'Quartz', category: 'Mineral' },
  { name: 'Corundum', category: 'Mineral' },
  { name: 'Diamond', category: 'Mineral' },
  { name: 'Bexalite', category: 'Mineral' },
  { name: 'Beryl', category: 'Mineral' },
  { name: 'Quantanium', category: 'Mineral' },
  { name: 'Hydrogen', category: 'Gas' },
  { name: 'Hydrogen Fuel', category: 'Fuel' },
  { name: 'Quantum Fuel', category: 'Fuel' },
  { name: 'Nitrogen', category: 'Gas' },
  { name: 'Helium', category: 'Gas' },
  { name: 'Chlorine', category: 'Halogen' },
  { name: 'Fluorine', category: 'Halogen' },
  { name: 'Processed Food', category: 'Food' },
  { name: 'Fresh Food', category: 'Food' },
  { name: 'Agricultural Supplies', category: 'Agricultural' },
  { name: 'Medical Supplies', category: 'Medical' },
  { name: 'Stims', category: 'Medical' },
  { name: 'Distilled Spirits', category: 'Vice' },
  { name: 'Scrap', category: 'Waste' },
  { name: 'Waste', category: 'Waste' },
  { name: 'Recycled Material Composite', category: 'Waste' },
  { name: 'Ship Ammunition', category: 'Munitions' },
  { name: 'Souvenirs', category: 'Vice' },
  { name: 'Pressurized Ice', category: 'Mineral' },
]

const CATEGORY_COLORS: Record<CommodityCategory, string> = {
  Metal: '#9fb4c4',
  Mineral: '#7fd4c0',
  Medical: '#ff7d9c',
  Agricultural: '#b6e06a',
  Food: '#9bd06a',
  Waste: '#b08a5a',
  Halogen: '#c9a0ff',
  Gas: '#8fd0ff',
  Fuel: '#ffb86a',
  Vice: '#ff9b5a',
  Munitions: '#ff6b6b',
  Industrial: '#88a0c0',
  Other: '#8fb0c8',
}

export function commodityCategory(name: string): CommodityCategory {
  const base = name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()
    .toLowerCase()
  return COMMODITIES.find((c) => c.name.toLowerCase() === base)?.category ?? 'Other'
}

export function commodityColor(name: string): string {
  return CATEGORY_COLORS[commodityCategory(name)] ?? CATEGORY_COLORS.Other
}

// Short, consistent codes shown on cargo cells / labels (no vowels-soup guessing).
const COMMODITY_CODES: Record<string, string> = {
  titanium: 'TI',
  aluminum: 'AL',
  iron: 'FE',
  copper: 'CU',
  tungsten: 'WLF',
  gold: 'AU',
  agricium: 'AGR',
  laranite: 'LAR',
  cobalt: 'CO',
  quartz: 'QZ',
  corundum: 'CRD',
  diamond: 'DIA',
  bexalite: 'BEX',
  beryl: 'BRL',
  quantanium: 'QTN',
  stims: 'STM',
  'medical supplies': 'MED',
  'processed food': 'PF',
  'fresh food': 'FF',
  'agricultural supplies': 'AGS',
  'distilled spirits': 'DST',
  souvenirs: 'SVN',
  'pressurized ice': 'ICE',
  hydrogen: 'HYD',
  'hydrogen fuel': 'HYF',
  'quantum fuel': 'QF',
  nitrogen: 'N2',
  helium: 'HE',
  chlorine: 'CL',
  fluorine: 'FL',
  scrap: 'SCR',
  waste: 'WST',
  'recycled material composite': 'RMC',
  'ship ammunition': 'AMM',
}

/** A compact code for a commodity, e.g. "Titanium (Ore)" -> "TI", "Ship Ammunition" -> "AMM". */
export function commodityCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()
  if (COMMODITY_CODES[base]) return COMMODITY_CODES[base]
  const words = base.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    return words
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3)
  }
  const noVowels = base.replace(/[aeiou]/gi, '')
  return (noVowels || base).slice(0, 3).toUpperCase()
}
