import React from 'react';
import { Match } from '@/types';

/**
 * Consumer surface hard-stop.
 *
 * This component previously rendered internal SRE/debug tooling in the match
 * detail surface. It is intentionally disabled so operational traces never
 * appear in user-facing UI.
 */
export const TechnicalDebugView = (_props: { match: Match }) => null;

export default TechnicalDebugView;
