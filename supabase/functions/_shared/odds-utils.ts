/**
 * Shared Sports Intelligence Utilities
 * Centralized logic for team name normalization, alias mapping, and fuzzy matching.
 */

// ============================================================================
// 1. TEAM ALIASES (Source of Truth)
// ============================================================================
export const TEAM_ALIASES: Record<string, string[]> = {
  // NFL
  'arizonacardinals': ['azcardinals', 'cardinals', 'arizona'],
  'atlantafalcons': ['atlfalcons', 'falcons', 'atlanta'],
  'baltimoreravens': ['balravens', 'ravens', 'baltimore'],
  'buffalobills': ['bufbills', 'bills', 'buffalo'],
  'carolinapanthers': ['carpanthers', 'panthers', 'carolina'],
  'chicagobears': ['chibears', 'bears', 'chicago'],
  'cincinnatibengals': ['cinbengals', 'bengals', 'cincinnati'],
  'clevelandbrowns': ['clebrowns', 'browns', 'cleveland'],
  'dallascowboys': ['dalcowboys', 'cowboys', 'dallas'],
  'denverbroncos': ['denbroncos', 'broncos', 'denver'],
  'detroitlions': ['detlions', 'lions', 'detroit'],
  'greenbaypackers': ['gbpackers', 'packers', 'greenbay'],
  'houstontexans': ['houtexans', 'texans', 'houston'],
  'indianapoliscolts': ['indcolts', 'colts', 'indianapolis', 'indy'],
  'jacksonvillejaguars': ['jaxjaguars', 'jaguars', 'jacksonville', 'jags'],
  'kansascitychiefs': ['kcchiefs', 'chiefs', 'kansascity'],
  'lasvegasraiders': ['lvraiders', 'raiders', 'lasvegas', 'oakland', 'oaklandraiders'],
  'losangeleschargers': ['lachargers', 'chargers', 'sandiegochargers'],
  'losangelesrams': ['larams', 'rams', 'stlouisrams'],
  'miamidolphins': ['miadolphins', 'dolphins', 'miami'],
  'minnesotavikings': ['minvikings', 'vikings', 'minnesota'],
  'newenglandpatriots': ['nepatriots', 'patriots', 'pats', 'newengland'],
  'neworleanssaints': ['nosints', 'saints', 'neworleans'],
  'newyorkgiants': ['nygiants', 'giants', 'nygints'],
  'newyorkjets': ['nyjets', 'jets'],
  'philadelphiaeagles': ['phieagles', 'eagles', 'philadelphia', 'philly'],
  'pittsburghsteelers': ['pitsteelers', 'steelers', 'pittsburgh'],
  'sanfrancisco49ers': ['sf49ers', '49ers', 'niners', 'sanfrancisco'],
  'seattleseahawks': ['seasehawks', 'seahawks', 'seattle'],
  'tampabaybuccaneers': ['tbbuccaneers', 'buccaneers', 'bucs', 'tampabay', 'tampa'],
  'tennesseetitans': ['tentitans', 'titans', 'tennessee'],
  'washingtoncommanders': ['wascommanders', 'commanders', 'washington', 'redskins'],

  // NBA
  'atlantahawks': ['atlhawks', 'hawks'],
  'bostonceltics': ['bosceltics', 'celtics', 'boston'],
  'brooklynnets': ['bknnets', 'nets', 'brooklyn', 'newjerseynets'],
  'charlottehornets': ['chahornets', 'hornets', 'charlotte'],
  'chicagobulls': ['chibulls', 'bulls'],
  'clevelandcavaliers': ['clecavaliers', 'cavaliers', 'cavs', 'cleveland'],
  'dallasmavericks': ['dalmavericks', 'mavericks', 'mavs', 'dallas'],
  'denvernuggets': ['dennuggets', 'nuggets', 'denver'],
  'detroitpistons': ['detpistons', 'pistons', 'detroit'],
  'goldenstatewarriors': ['gswwarriors', 'warriors', 'goldenstate', 'gsw'],
  'houstonrockets': ['hourockets', 'rockets', 'houston'],
  'indianapacers': ['indpacers', 'pacers', 'indiana'],
  'losangelesclippers': ['laclippers', 'clippers', 'lac'],
  'losangeleslakers': ['lalakers', 'lakers', 'lal'],
  'memphisgrizzlies': ['memgrizzlies', 'grizzlies', 'memphis'],
  'miamiheat': ['miaheat', 'heat', 'miami'],
  'milwaukeebucks': ['milbucks', 'bucks', 'milwaukee'],
  'minnesotatimberwolves': ['mintimberwolves', 'timberwolves', 'wolves', 'minnesota', 'twolves'],
  'neworleanspelicans': ['nopelicans', 'pelicans', 'neworleans'],
  'newyorkknicks': ['nykknicks', 'knicks', 'newyork'],
  'oklahomacitythunder': ['okcthunder', 'thunder', 'okc', 'oklahomacity'],
  'orlandomagic': ['orlmagic', 'magic', 'orlando'],
  'philadelphia76ers': ['phi76ers', '76ers', 'sixers', 'philadelphia', 'philly'],
  'phoenixsuns': ['phxsuns', 'suns', 'phoenix'],
  'portlandtrailblazers': ['portrailblazers', 'trailblazers', 'blazers', 'portland'],
  'sacramentokings': ['sackings', 'kings', 'sacramento'],
  'sanantoniospurs': ['sasspurs', 'spurs', 'sanantonio'],
  'torontoraptors': ['torraptors', 'raptors', 'toronto'],
  'utahjazz': ['utajazz', 'jazz', 'utah'],
  'washingtonwizards': ['waswizards', 'wizards'],

  // NHL
  'anaheimducks': ['anaducks', 'ducks', 'anaheim', 'mightyducks'],
  'arizonacoyotes': ['aricoyotes', 'coyotes', 'arizona', 'phoenixcoyotes', 'utahhc', 'utahmammoth', 'utah'],
  'bostonbruins': ['bosbruins', 'bruins', 'boston'],
  'buffalosabres': ['bufsabres', 'sabres', 'buffalo'],
  'calgaryflames': ['calflames', 'flames', 'calgary'],
  'carolinahurricanes': ['carhurricanes', 'hurricanes', 'carolina'],
  'chicagoblackhawks': ['chiblackhawks', 'blackhawks', 'chicago'],
  'coloradoavalanche': ['colavalanche', 'avalanche', 'avs', 'colorado'],
  'columbusbluejackets': ['colbluejackets', 'bluejackets', 'columbus', 'cbj'],
  'dallasstars': ['dalstars', 'stars', 'dallas'],
  'detroitredwings': ['detredwings', 'redwings', 'detroit', 'wings'],
  'edmontonoilers': ['edmoilers', 'oilers', 'edmonton'],
  'floridapanthers': ['flapanthers', 'panthers', 'florida'],
  'losangeleskings': ['lakings', 'kings', 'losangeles'],
  'minnesotawild': ['minwild', 'wild', 'minnesota'],
  'montrealcanadiens': ['mtlcanadiens', 'canadiens', 'habs', 'montreal', 'montrealcanadiens'],
  'nashvillepredators': ['nshpredators', 'predators', 'preds', 'nashville'],
  'newjerseydevils': ['njdevils', 'devils', 'newjersey'],
  'newyorkislanders': ['nyislanders', 'islanders', 'isles'],
  'newyorkrangers': ['nyrangers', 'rangers'],
  'ottawasenators': ['ottsenators', 'senators', 'sens', 'ottawa'],
  'philadelphiaflyers': ['phiflyers', 'flyers', 'philadelphia', 'philly'],
  'pittsburghpenguins': ['pitpenguins', 'penguins', 'pens', 'pittsburgh'],
  'sanjosesharks': ['sjsharks', 'sharks', 'sanjose'],
  'seattlekraken': ['seakraken', 'kraken', 'seattle'],
  'stlouisblues': ['stlblues', 'blues', 'stlouis'],
  'tampabaylightning': ['tbllightning', 'lightning', 'bolts', 'tampabay', 'tampa'],
  'torontomapleleafs': ['tormapleleafs', 'mapleleafs', 'leafs', 'toronto', 'torontoleafs'],
  'vancouvercanucks': ['vancanucks', 'canucks', 'vancouver'],
  'vegasgoldenknights': ['vgkgoldenknights', 'goldenknights', 'knights', 'vegas', 'vgk'],
  'washingtoncapitals': ['wascapitals', 'capitals', 'caps', 'washington'],
  'winnipegjets': ['wpgjets', 'jets', 'winnipeg'],

  // MLB
  'arizonadiamondbacks': ['aridiamondbacks', 'diamondbacks', 'dbacks', 'arizona'],
  'atlantabraves': ['atlbraves', 'braves', 'atlanta'],
  'baltimoreorioles': ['balorioles', 'orioles', 'baltimore'],
  'bostonredsox': ['bosredsox', 'redsox', 'boston', 'sox'],
  'chicagocubs': ['chicubs', 'cubs', 'cubbies'],
  'chicagowhitesox': ['chiwhitesox', 'whitesox', 'chisox'],
  'cincinnatireds': ['cinreds', 'reds', 'cincinnati'],
  'clevelandguardians': ['cleguardians', 'guardians', 'cleveland', 'clevelandindians', 'indians'],
  'coloradorockies': ['colrockies', 'rockies', 'colorado'],
  'detroittigers': ['dettigers', 'tigers', 'detroit'],
  'houstonastros': ['houastros', 'astros', 'houston'],
  'kansascityroyals': ['kcroyals', 'royals', 'kansascity'],
  'losangelesangels': ['laaangels', 'angels', 'losangeles', 'anaheimangels', 'laangels'],
  'losangelesdodgers': ['laddodgers', 'dodgers', 'losangeles'],
  'miamimarlins': ['miamarlins', 'marlins', 'miami', 'floridamarlins'],
  'milwaukeebrewers': ['milbrewers', 'brewers', 'milwaukee'],
  'minnesotatwins': ['mintwins', 'twins', 'minnesota'],
  'newyorkmets': ['nymmets', 'mets', 'newyork'],
  'newyorkyankees': ['nyyyankees', 'yankees', 'newyork', 'yanks'],
  'oaklandathletics': ['oakathletics', 'athletics', 'oakland', 'as'],
  'philadelphiaphillies': ['phiphillies', 'phillies', 'philadelphia', 'philly'],
  'pittsburghpirates': ['pitpirates', 'pirates', 'pittsburgh'],
  'sandiegopadres': ['sdpadres', 'padres', 'sandiego'],
  'sanfranciscogiants': ['sfgiants', 'giants', 'sanfrancisco'],
  'seattlemariners': ['seamariners', 'mariners', 'seattle'],
  'stlouiscardinals': ['stlcardinals', 'cardinals', 'stlouis'],
  'tampabayrays': ['tbrays', 'rays', 'tampabay', 'tampa'],
  'texasrangers': ['texrangers', 'rangers', 'texas'],
  'torontobluejays': ['torbluejays', 'bluejays', 'jays', 'toronto'],
  'washingtonnationals': ['wasnationals', 'nationals', 'nats', 'washington'],

  // College (NCAA)
  'uconn': ['connecticut', 'connecticuthuskies', 'uconnhuskies'],
  'usc': ['southerncalifornia', 'southerncal', 'usctrojans'],

  // Premier League
  'arsenal': ['arsenalfc', 'gunners'],
  'astonvilla': ['astonvillafc', 'villa', 'avfc'],
  'bournemouth': ['afcbournemouth', 'cherries'],
  'brentford': ['brentfordfc', 'bees'],
  'brightonandhovealbion': ['brighton', 'brightonhovealbion', 'seagulls', 'bhafc'],
  'burnley': ['burnleyfc', 'clarets'],
  'chelsea': ['chelseafc', 'blues', 'cfc'],
  'crystalpalace': ['crystalpalacefc', 'palace', 'eagles', 'cpfc'],
  'everton': ['evertonfc', 'toffees', 'efc'],
  'fulham': ['fulhamfc', 'cottagers', 'ffc'],
  'ipswich': ['ipswichtown', 'ipswichtownfc', 'tractorboys'],
  'leicester': ['leicestercity', 'leicestercityfc', 'foxes', 'lcfc'],
  'liverpool': ['liverpoolfc', 'reds', 'lfc'],
  'luton': ['lutontown', 'lutontownfc', 'hatters'],
  'manchestercity': ['mancity', 'manchestercityfc', 'citizens', 'mcfc', 'city'],
  'manchesterunited': ['manunited', 'manchesterunitedfc', 'reddevils', 'mufc', 'manutd', 'united'],
  'newcastleunited': ['newcastle', 'newcastleunitedfc', 'magpies', 'nufc'],
  'nottinghamforest': ['nottmforest', 'nottinghamforestfc', 'forest', 'nffc'],
  'sheffieldunited': ['sheffutd', 'sheffieldunitedfc', 'blades', 'sufc'],
  'southampton': ['southamptonfc', 'saints', 'sfc'],
  'tottenhamhotspur': ['tottenham', 'tottenhamhotspurfc', 'spurs', 'thfc'],
  'westhamunited': ['westham', 'westhamunitedfc', 'hammers', 'whufc', 'irons'],
  'wolverhamptonwanderers': ['wolves', 'wolverhampton', 'wolverhamptonwanderersfc', 'wwfc'],

  // La Liga
  'athleticbilbao': ['athleticclub', 'athletic', 'bilbao'],
  'atleticomadrid': ['atletico', 'atleticomadrid', 'atleti'],
  'barcelona': ['fcbarcelona', 'barca', 'fcb'],
  'betis': ['realbetis', 'realbetisbalompie'],
  'cadiz': ['cadizcf'],
  'celtavigo': ['celta', 'rceltavigo'],
  'getafe': ['getafecf'],
  'girona': ['gironafc'],
  'lapalmas': ['udlaspalmas', 'laspalmas'],
  'mallorca': ['rcdmallorca'],
  'osasuna': ['caosasuna'],
  'rayovallecano': ['rayo'],
  'realmadrid': ['madrid', 'rmadrid', 'blancos'],
  'realsociedad': ['lasociedad', 'sociedad'],
  'sevilla': ['sevillafc'],
  'valencia': ['valenciacf'],
  'valladolid': ['realvalladolid'],
  'villarreal': ['villarrealcf'],
  'alaves': ['deportivoalaves'],
  'espanyol': ['rcdespaynol'],

  // Bundesliga
  'bayernmunich': ['bayern', 'fcbayern', 'fcbayernmunchen', 'bavarians'],
  'borussiadormund': ['dortmund', 'bvb', 'borussia', 'borussiadortmund'],
  'rbleipzig': ['leipzig', 'redbullleipzig'],
  'bayerleverkusen': ['leverkusen', 'bayer04', 'bayer'],
  'unionberlin': ['fcunionberlin', '1fcunionberlin', 'union'],
  'scfreiburg': ['freiburg', 'sportclubfreiburg'],
  'eintrachtfrankfurt': ['frankfurt', 'eintracht', 'sge'],
  'wolfsburg': ['vflwolfsburg'],
  'mainz05': ['mainz', '1fsvmainz05', 'fsvmainz'],
  'borussiamönchengladbach': ['gladbach', 'monchengladbach', 'borussiamgladbach', 'bmg'],
  'koln': ['cologne', '1fckoln', 'fckoln', 'effzeh'],
  'hoffenheim': ['tsghoffenheim', 'tsg1899hoffenheim', 'tsg'],
  'werderbremen': ['bremen', 'svwerderbremen', 'werder'],
  'vfbstuttgart': ['stuttgart', 'vfb'],
  'augsburg': ['fcaugsburg', 'fca'],
  'bochum': ['vflbochum'],
  'heidenheim': ['1fcheidenheim', 'fcheidenheim'],
  'darmstadt': ['svdarmstadt98', 'darmstadt98'],
  'stpauli': ['fcstpauli', 'saintpauli'],

  // Serie A
  'acmilan': ['milan', 'rossoneri'],
  'internazionale': ['inter', 'intermilan', 'fcinter', 'fcinternazionale', 'nerazzurri'],
  'juventus': ['juve', 'juventusfc', 'bianconeri'],
  'napoli': ['sscnapoli', 'partenopei'],
  'roma': ['asroma', 'giallorossi'],
  'lazio': ['sslazio', 'biancocelesti'],
  'atalanta': ['atalantabc', 'dea'],
  'fiorentina': ['acffiorentina', 'viola'],
  'bologna': ['bolognafc', 'rossoblù'],
  'torino': ['torinfc', 'granata', 'toro'],
  'monza': ['acmonza'],
  'udinese': ['udinesecalcio'],
  'sassuolo': ['ussassuolo', 'neroverdi'],
  'empoli': ['empolifc'],
  'salernitana': ['ussalernitana'],
  'lecce': ['uslecce'],
  'verona': ['hellasverona', 'hellas'],
  'cagliari': ['cagliaricalcio'],
  'frosinone': ['frosinonecalcio'],
  'genoa': ['genoacfc', 'grifone'],
  'sampdoria': ['ucsampdoria', 'samp', 'doria'],
  'venezia': ['veneziafc'],
  'parma': ['parmacalcio'],
  'como': ['comocalcio'],
  'pisa': ['pisasportingclub', 'pisasc'],
  'cremonese': ['uscremonese'],

  // Ligue 1
  'parissaintgermain': ['psg', 'paris', 'parissg'],
  'marseille': ['olympiquedemarseille', 'om', 'olympiquemarseille'],
  'monaco': ['asmonaco', 'asm'],
  'lille': ['losc', 'lilleosc'],
  'lyon': ['olympiquelyonnais', 'ol', 'olympiquelyon'],
  'lens': ['rclens', 'rcl'],
  'rennes': ['staderennais', 'srfc'],
  'nice': ['ogcnice', 'ogc'],
  'strasbourg': ['rcstrasbourg', 'rcs', 'racing'],
  'nantes': ['fcnantes', 'fcn'],
  'montpellier': ['montpellierhsc', 'mhsc'],
  'reims': ['stadedereims', 'sdr'],
  'toulouse': ['toulousefc', 'tfc'],
  'brest': ['stadebrestois29', 'sb29'],
  'clermont': ['clermontfoot', 'cf63'],
  'lorient': ['fclorient', 'fcl'],
  'metz': ['fcmetz'],
  'lehavre': ['havre', 'havreac', 'hac'],
  'angers': ['angerssco', 'sco'],
  'auxerre': ['ajauxerre', 'aja'],
  'saintetienne': ['asse', 'lesverts'],

  // UEFA / Rest of Europe
  'benfica': ['slbenfica', 'aguias'],
  'porto': ['fcporto', 'fcp', 'dragoes'],
  'sportingcp': ['sporting', 'sportinglisbon', 'sportingclubdeportugal', 'scp'],
  'braga': ['scbraga', 'sportingbraga'],
  'ajax': ['afcajax', 'ajaxamsterdam'],
  'psveindhoven': ['psv', 'philipssportvereniging'],
  'feyenoord': ['feyenoordrotterdam'],
  'azalkmaar': ['az', 'alkmaar'],
  'fcutrecht': ['utrecht'],
  'clubbrugge': ['brugge', 'bruges'],
  'anderlecht': ['rscanderlecht', 'rsca'],
  'gent': ['kaagent', 'kaa'],
  'genk': ['krcgenk', 'krc', 'racinggenk'],
  'royalunionsaintgilloise': ['unionstgilloise', 'unionsg', 'rusg'],
  'celtic': ['celticfc', 'glasgowceltic', 'hoops', 'bhoys'],
  'rangers': ['rangersfc', 'glasgowrangers', 'gers'],
  'galatasaray': ['galatasaraysk', 'gala', 'cimbom'],
  'fenerbahce': ['fenerbahcesk', 'fener'],
  'besiktas': ['besiktasjk', 'bjk'],
  'trabzonspor': ['trabzon'],
  'olympiacos': ['olympiakos', 'olympiakosp', 'olympiakospiraeus', 'olympiacospiraeus', 'thrylos'],
  'panathinaikos': ['panathinaikosfc', 'pao'],
  'paok': ['paoksalonika', 'paokthessaloniki', 'paokfc'],
  'aek': ['aekathens', 'aekfc'],
  'redbullsalzburg': ['salzburg', 'rbsalzburg', 'rbs'],
  'rapidwien': ['rapidvienna', 'rapid'],
  'sturm': ['sksturmgraz', 'sturmgraz'],
  'lask': ['lasklinz', 'linz'],
  'youngboys': ['bscyoungboys', 'bscyb', 'yb', 'bern'],
  'fcbasel': ['basel', 'rotblau'],
  'fczurich': ['zurich'],
  'slavia': ['slaviapraha', 'slaviaprague'],
  'sparta': ['spartapraha', 'spartaprague'],
  'viktoriaplzen': ['plzen', 'viktorka', 'fcviktoria'],
  'shakhtardonetsk': ['shakhtar', 'shakhtyor', 'miners'],
  'dynamokyiv': ['dynamokiev', 'dynamo'],
  'dinamozagreb': ['dinamo', 'gnkdinamo'],
  'hajduksplit': ['hajduk', 'hnkhajduk'],
  'redstarbelgrade': ['crvenazvezda', 'redstar', 'zvezda', 'fkcrvenazvezda'],
  'partizanbelgrade': ['partizan', 'fkpartizan'],
  'copenhagen': ['fccopenhagen', 'fck', 'fckoebenhavn', 'fckoebenhaven', 'fckopenhamn'],
  'midtjylland': ['fcmidtjylland', 'fcm'],
  'brondby': ['brondbyif', 'bif'],
  'malmo': ['malmoff', 'mff'],
  'rosenborg': ['rosenborgbk', 'rbk'],
  'bodoglimt': ['bodo', 'glimt', 'fkbodoglimt', 'bodøglimt'],
  'brann': ['skbrann', 'bergen'],
  'ferencvaros': ['ferencvarostc', 'ftc', 'fradi'],
  'maccabitelaviv': ['maccabita', 'mta'],
  'maccabihaifa': ['haifa', 'mch'],
  'kairat': ['fckairat', 'kairatalmaty', 'kayrat'],
  'astana': ['fcastana'],
  'qarabag': ['qarabagfk', 'fkqarabag', 'qarabağ'],
  'ludogoretsrazgrad': ['ludogorets', 'razgrad'],
  'slovanbrataslava': ['slovan', 'slovanbratislava'],
  'rfrugby': ['rfr', 'rubin'],
  'fctwente': ['twente', 'twentefc'],
  'realwuerzburg': ['wuerzburg'],
  'psvsindoven': ['psv'],
  'macabi': ['maccabi'],
  'steauabucharest': ['fcsb', 'steaua'],
  'cfrcluj': ['cfr', 'clujnapoca'],
  'alkmaar': ['azalkmaar', 'az'],
};

// ============================================================================
// 2. HELPER TYPES
// ============================================================================

export interface OddsGameCandidate {
  home_team: string;
  away_team: string;
  commence_time: string; // ISO String
  [key: string]: any;
}

// ============================================================================
// 3. NORMALIZATION & MATCHING LOGIC
// ============================================================================

export const normalizeName = (s: string): string => {
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

export const levenshteinSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  return 1 - distance / Math.max(a.length, b.length);
};

const isTeamMatch = (a: string, b: string): boolean => {
  // Direct containment covers most cases since we normalize out spaces
  if (a.includes(b) || b.includes(a)) return true;
  return false;
};

const matchesViaAlias = (espnNorm: string, oddsNorm: string): boolean => {
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const allForms = [canonical, ...aliases];
    const espnMatches = allForms.some(f => espnNorm.includes(f) || f.includes(espnNorm));
    const oddsMatches = allForms.some(f => oddsNorm.includes(f) || f.includes(oddsNorm));
    
    if (espnMatches && oddsMatches) return true;
  }
  return false;
};

export const findMatchingOddsGame = <T extends OddsGameCandidate>(
  espnHome: string,
  espnAway: string,
  oddsGames: T[],
  espnDateStr?: string 
): T | undefined => {
  if (!oddsGames || oddsGames.length === 0) return undefined;

  const hNorm = normalizeName(espnHome);
  const aNorm = normalizeName(espnAway);
  const espnTime = espnDateStr ? new Date(espnDateStr).getTime() : Date.now();

  return oddsGames.find(g => {
    // 0. Time Check 
    if (espnDateStr && g.commence_time) {
      const gameTime = new Date(g.commence_time).getTime();
      if (Math.abs(espnTime - gameTime) > 172_800_000) return false;
    }

    const ghNorm = normalizeName(g.home_team);
    const gaNorm = normalizeName(g.away_team);

    // 1. Direct Match
    if (isTeamMatch(hNorm, ghNorm) && isTeamMatch(aNorm, gaNorm)) return true;

    // 2. Alias Match
    if (matchesViaAlias(hNorm, ghNorm) && matchesViaAlias(aNorm, gaNorm)) return true;

    // 3. Fuzzy Match
    if (levenshteinSimilarity(hNorm, ghNorm) > 0.8 && 
        levenshteinSimilarity(aNorm, gaNorm) > 0.8) {
      return true;
    }

    return false;
  });
};
