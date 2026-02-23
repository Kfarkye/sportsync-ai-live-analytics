import React from 'react';
import { Match, Sport, Team } from '@/types';

interface GameContextCardProps {
    match: Match;
}

// Fix: Augment Team type locally for GameContext logic
interface AugmentedTeam extends Team {
    conference?: string;
    division?: string;
}

/**
 * Extract meaningful game context that ISN'T already in the header
 * 
 * Examples:
 * - NFL: "Week 18" or "NFC Championship"
 * - NCAAF: "Rose Bowl" or "CFP Semifinal"  
 * - NCAAB: "March Madness - Sweet 16" or "Big Ten Tournament"
 * - NBA: "Play-In Tournament" or "Conference Finals"
 * - NHL: "Stanley Cup Game 4"
 */
export const extractGameContext = (match: Match): {
    primary: string | null;
    secondary: string | null;
    matchupType: string | null;
} => {
    const name = match.name || '';
    const notes = match.notes || '';
    const sport = match.sport;
    const seasonType = match.seasonType;

    let primary: string | null = null;
    let secondary: string | null = null;
    let matchupType: string | null = null;

    // Combine name and notes for pattern matching
    const combined = `${name} ${notes}`.toLowerCase();

    // ============================================
    // COLLEGE FOOTBALL - Bowl Games & Playoffs
    // ============================================
    if (sport === Sport.COLLEGE_FOOTBALL) {
        // Check for bowl game names
        if (combined.includes('bowl')) {
            // Extract bowl name (e.g., "Rose Bowl", "Sugar Bowl")
            const bowlMatch = name.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Bowl)/i);
            if (bowlMatch) {
                primary = bowlMatch[1];
            } else if (name.toLowerCase().includes('bowl')) {
                primary = name;
            }
        }
        // CFP games
        else if (combined.includes('cfp') || combined.includes('playoff')) {
            if (combined.includes('championship')) {
                primary = 'CFP National Championship';
            } else if (combined.includes('semifinal')) {
                primary = 'CFP Semifinal';
            } else if (combined.includes('quarterfinal')) {
                primary = 'CFP Quarterfinal';
            } else {
                primary = 'College Football Playoff';
            }
        }
        // Regular season - extract week if available
        else if (seasonType === 2) {
            const weekMatch = combined.match(/week\s*(\d+)/i);
            if (weekMatch) {
                primary = `Week ${weekMatch[1]}`;
            }
        }
    }

    // ============================================
    // NFL - Weeks & Playoff Rounds
    // ============================================
    else if (sport === Sport.NFL) {
        if (seasonType === 3 || combined.includes('playoff')) {
            if (combined.includes('super bowl')) {
                primary = 'Super Bowl';
            } else if (combined.includes('conference') || combined.includes('championship')) {
                // Determine conference
                if (combined.includes('afc')) {
                    primary = 'AFC Championship';
                } else if (combined.includes('nfc')) {
                    primary = 'NFC Championship';
                } else {
                    primary = 'Conference Championship';
                }
            } else if (combined.includes('divisional')) {
                primary = 'Divisional Round';
            } else if (combined.includes('wild card')) {
                primary = 'Wild Card Round';
            }
        } else {
            // Regular season - extract week
            const weekMatch = combined.match(/week\s*(\d+)/i);
            if (weekMatch) {
                primary = `Week ${weekMatch[1]}`;
            }
        }

        // Division matchup detection
        const away = match.awayTeam as AugmentedTeam;
        const home = match.homeTeam as AugmentedTeam;
        const awayConf = away?.conference;
        const homeConf = home?.conference;
        const awayDiv = away?.division;
        const homeDiv = home?.division;

        if (awayDiv && homeDiv && awayDiv === homeDiv) {
            matchupType = `${homeDiv} Matchup`;
        } else if (awayConf && homeConf && awayConf !== homeConf) {
            matchupType = 'Interconference';
        }
    }

    // ============================================
    // COLLEGE BASKETBALL - Tournaments
    // ============================================
    else if (sport === Sport.COLLEGE_BASKETBALL) {
        if (combined.includes('march madness') || combined.includes('ncaa tournament')) {
            if (combined.includes('final four')) {
                primary = 'Final Four';
            } else if (combined.includes('elite eight') || combined.includes('elite 8')) {
                primary = 'Elite Eight';
            } else if (combined.includes('sweet sixteen') || combined.includes('sweet 16')) {
                primary = 'Sweet Sixteen';
            } else if (combined.includes('second round')) {
                primary = 'NCAA Tournament - Round of 32';
            } else if (combined.includes('first round')) {
                primary = 'NCAA Tournament - Round of 64';
            } else if (combined.includes('championship')) {
                primary = 'National Championship';
            } else {
                primary = 'March Madness';
            }
        }
        // Conference tournaments
        else if (combined.includes('tournament')) {
            // Extract tournament name
            const tourneyPatterns = [
                /([A-Za-z\s]+)\s+tournament/i,
                /([A-Za-z\s]+)\s+conference\s+tournament/i
            ];
            for (const pattern of tourneyPatterns) {
                const match = name.match(pattern);
                if (match && match[1].length < 30) {
                    primary = `${match[1].trim()} Tournament`;
                    break;
                }
            }
            if (!primary && name.toLowerCase().includes('tournament')) {
                primary = 'Conference Tournament';
            }
        }
        // NIT
        else if (combined.includes('nit')) {
            primary = 'NIT';
        }
    }

    // ============================================
    // NBA - Playoffs & Special Events
    // ============================================
    else if (sport === Sport.NBA || sport === Sport.BASKETBALL) {
        if (combined.includes('finals')) {
            primary = 'NBA Finals';
        } else if (combined.includes('conference') && (combined.includes('semifinal') || combined.includes('semi'))) {
            primary = 'Conference Semifinals';
        } else if (combined.includes('conference') && combined.includes('final')) {
            primary = 'Conference Finals';
        } else if (combined.includes('first round')) {
            primary = 'First Round';
        } else if (combined.includes('play-in') || combined.includes('playin')) {
            primary = 'Play-In Tournament';
        } else if (combined.includes('cup') || combined.includes('in-season')) {
            if (combined.includes('final')) {
                primary = 'NBA Cup Final';
            } else if (combined.includes('knockout')) {
                primary = 'NBA Cup Knockout';
            } else {
                primary = 'NBA Cup';
            }
        }

        // Game number for playoff series
        const gameMatch = combined.match(/game\s*(\d+)/i);
        if (gameMatch && seasonType === 3) {
            secondary = `Game ${gameMatch[1]}`;
        }
    }

    // ============================================
    // NHL - Playoffs
    // ============================================
    else if (sport === Sport.HOCKEY) {
        if (combined.includes('stanley cup')) {
            if (combined.includes('final')) {
                primary = 'Stanley Cup Finals';
            } else {
                primary = 'Stanley Cup Playoffs';
            }
        } else if (combined.includes('conference') && combined.includes('final')) {
            primary = 'Conference Finals';
        } else if (combined.includes('second round')) {
            primary = 'Second Round';
        } else if (combined.includes('first round')) {
            primary = 'First Round';
        }

        // Game number
        const gameMatch = combined.match(/game\s*(\d+)/i);
        if (gameMatch && seasonType === 3) {
            secondary = `Game ${gameMatch[1]}`;
        }
    }

    // ============================================
    // SOCCER - Competitions
    // ============================================
    else if (sport === Sport.SOCCER) {
        if (combined.includes('champions league')) {
            primary = 'Champions League';
        } else if (combined.includes('world cup')) {
            primary = 'World Cup';
        } else if (combined.includes('final')) {
            primary = name || 'Cup Final';
        }
    }

    return { primary, secondary, matchupType };
};

const GameContextCard: React.FC<GameContextCardProps> = ({ match }) => {
    const { primary, secondary, matchupType } = extractGameContext(match);

    // If no specific context, don't render anything
    if (!primary && !secondary && !matchupType) {
        return null;
    }

    return (
        <div className="relative">
            {/* Primary Context (Week/Round/Bowl) */}
            {primary && (
                <div className="py-3 border-b border-edge-subtle">
                    <div className="text-caption font-semibold text-zinc-600 uppercase tracking-expanded mb-1">
                        Game
                    </div>
                    <div className="text-body-lg font-semibold text-white tracking-tight">
                        {primary}
                    </div>
                    {secondary && (
                        <div className="text-small font-medium text-zinc-400 mt-0.5">
                            {secondary}
                        </div>
                    )}
                </div>
            )}

            {/* Matchup Type (Division/Conference) */}
            {matchupType && (
                <div className="py-3 border-b border-edge-subtle">
                    <div className="text-caption font-semibold text-zinc-600 uppercase tracking-expanded mb-1">
                        Matchup
                    </div>
                    <div className="text-body font-medium text-zinc-300 tracking-tight">
                        {matchupType}
                    </div>
                </div>
            )}
        </div>
    );
};

export default GameContextCard;
