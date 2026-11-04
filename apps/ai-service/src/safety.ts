import { normalize } from './embeddings.js';

const EMERGENCY_TERMS = [
  'convuls',
  'envenen',
  'intoxic',
  'nao respira',
  'falta de ar',
  'sem respirar',
  'sangrando muito',
  'sangramento',
  'atropel',
  'desmaiou',
  'inconsciente',
  'engoliu',
  'veneno',
];

/**
 * Deterministic check that runs before the model: if the message looks like
 * an emergency the UI shows a banner with the clinic phone right away, even if
 * the language model is slow or unavailable.
 */
export function detectEmergency(message: string) {
  const text = normalize(message);
  return EMERGENCY_TERMS.some((term) => text.includes(term));
}
