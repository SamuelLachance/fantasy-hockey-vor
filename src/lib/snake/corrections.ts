/**
 * Hand-checked corrections to the Snake source DB, applied by the build
 * before the public-safety rules. Each one was checked against the episode
 * (the transcripts themselves are never published or committed: only the
 * corrected French paraphrase is).
 *
 * - `drop`: the opinion is filed under the wrong player or distorts what was
 *   said; it is never published (counted with the misidentified players, and
 *   the player's source synthesis, which used it, is withheld).
 * - `set`: replacement fields. A content fix (the automatic paraphrase
 *   generalized or misread a remark) also withholds the source synthesis,
 *   which was written from the old text; a `wording` fix (the paraphrase
 *   kept a long run of the captions' own words, caught by the verbatim
 *   guard) only rephrases, so the synthesis stays.
 *
 * Keyed by the source player key and the video id (unique per player).
 */
import type { SourceOpinion, SourceSynthesis } from "./sanitize";

export type OpinionPatch = Partial<
  Pick<SourceOpinion, "opinionFr" | "contextAtTime" | "projection" | "strengths" | "weaknesses" | "comparables" | "stance">
>;

export interface SnakeOpinionCorrection {
  key: string;
  vid: string;
  /** Why it is never published. */
  drop?: string;
  set?: OpinionPatch;
  /** `set` only rephrases (same meaning): the source synthesis stays. */
  wording?: true;
}

/** Rephrased paraphrase (verbatim guard): same meaning, not the captions' words. */
function reword(key: string, vid: string, opinionFr: string): SnakeOpinionCorrection {
  return { key, vid, set: { opinionFr }, wording: true };
}

export const SNAKE_OPINION_CORRECTIONS: readonly SnakeOpinionCorrection[] = [
  // ---- wrong player / distortion (content)
  // Kent Hughes' son (LAK 2022 #51, Northeastern), not the Devils' Jack Hughes.
  { key: "fx:04bdb", vid: "P2uEKVJ0WaA", drop: "namesake: Kent Hughes' son (LAK prospect)" },
  { key: "fx:04bdb", vid: "DATar20OmNU", drop: "namesake: Kent Hughes' son (LAK prospect)" },
  // "J'aime mieux son frère… qu'on n'a pas repêché finalement" (Dec. 2024):
  // Cole, whom Montreal passed on at the 2024 draft, not Quinn.
  { key: "fx:0632b", vid: "x-1E9SLsJOU", drop: "Hutson brothers mix-up (the remark is about Cole)" },
  // A remark about Anaheim's three centres, not a McTavish-specific call.
  {
    key: "fx:05gd8",
    vid: "FLlFkzlFaDE",
    set: {
      opinionFr:
        "Il ne prévoit pas d'échange. Avec Carlsson, McTavish et McQueen au centre à Anaheim, il estime que l'un des trois, celui qui sera le moins efficace à cette position, pourrait se retrouver à l'aile, sans dire lequel.",
      projection: null,
      weaknesses: [],
      stance: "neutre",
    },
  },

  // ---- wording only (verbatim guard: 10+ words shared with the captions)
  reword(
    "fx:05kj6",
    "DPBg-kqi_2s",
    "Snake en fait un joueur « 4A », comme au baseball : trop fort pour la LAH, où il produira beaucoup, mais pas assez pour la LNH. Selon lui, il manque de force physique pour soutenir une saison de 82 matchs à pleine intensité, et son talent ne compense pas son gabarit.",
  ),
  reword(
    "fx:06sqo",
    "HzvzlOK_6Js",
    "Né en Chine, il serait le premier joueur de ce pays à avoir une vraie chance d'atteindre la LNH. Il a commencé à jouer tard, mais sa progression a été fulgurante, au point d'être choisi avant Zharovsky au début du 2e tour. Son plafond offensif est très limité. Ce colosse qui patine bien pourrait toutefois devenir un défenseur défensif très utile, et les Sharks lui donneront toutes ses chances.",
  ),
  reword(
    "fx:02noo",
    "etrPNm7Rpmg",
    "À Stanstead, où il va comme recruteur junior, il l'a vu dominer comme personne, mais le calibre y est très loin du junior majeur. Le choix de 2012 ne l'avait pas surpris, mais il y voyait un risque réel. Loin du vol annoncé par Calgary, il a plutôt fait une longue carrière d'attaquant de 4e trio.",
  ),
  reword(
    "fx:05r1c",
    "DThXUlvRYrI",
    "Garder Slafkovsky à Montréal pour corriger les failles de son jeu a été critiqué, mais ce qu'il fait aujourd'hui donne raison au Canadien. Pour lui, c'est la preuve qu'il faut amener vite en Amérique du Nord un espoir européen qui avait pris de mauvais plis. Le joueur a toutefois traversé une crise de confiance.",
  ),
  reword(
    "fx:065d1",
    "fI-jmc242HA",
    "Il a obtenu 28 points en 35 matchs à UConn, et Snake juge que son transfert vers la puissance qu'est le Minnesota devrait beaucoup l'aider à progresser. Grand, habile et bon marqueur, il plaît à Snake, qui y voit un possible joueur de 2e trio.",
  ),
  reword(
    "fx:06r61",
    "ssXu15JA810",
    "Pour Snake, ce centre a un bon talent offensif et joue bien dans les deux sens; il devrait rester au centre dans la LNH. Il le voit partir en fin de 1re ronde.",
  ),
  reword(
    "fx:05rji",
    "UC9H5wm4QaA",
    "Selon Snake, ce n'est pas le talent qui manque à Gaucher, mais la vitesse d'exécution et le coup de patin nécessaires pour faire sa place dans la LNH. Il dominait à 19 ans avec Bolduc à Québec, mais son contrat d'entrée achève et l'avenir ne s'annonce pas bien, même si une place au 4e trio reste envisageable.",
  ),
  reword(
    "fx:06rut",
    "ki1ph32pN-U",
    "Pas un défenseur de première paire, mais un choix très sûr pour une deuxième paire, qui peut contribuer à l'attaque et peut-être jouer en avantage numérique. Il est solide défensivement. Il ferait partie des options de Snake à 16 ou 17 pour Montréal. C'est un choix de milieu de première ronde : une aubaine autour du 25e rang, mais une déception possible s'il est pris avant le 15e.",
  ),
  reword(
    "fx:06qfa",
    "lymho8pHbXI",
    "Selon Snake, Pickford devra passer du temps dans la Ligue américaine pour apprendre son métier de défenseur. S'il n'est pas échangé, il pourrait même être converti en ailier. C'est rare, mais Byfuglien et Burns ont déjà fait ce genre de changement.",
  ),
  reword(
    "fx:06cfs",
    "gROdg6I8foo",
    "Dans son groupe 5 à 10. S'il atteint la LNH, ce sera dans un rôle robuste, sans doute au 4e trio, avec quelques buts par saison si l'on se fie à sa production à Laval. Snake ignore combien de matchs il jouera. Il le préfère à Beck, sans en faire un dark horse.",
  ),
  reword(
    "fx:05tqt",
    "NaHnuCxecAg",
    "Il a été choisi au 23e rang parce que l'OHL n'a pas joué pendant l'année de la COVID et qu'on manquait de données sur lui. Avec une saison complète, il aurait peut-être été choisi parmi les dix premiers.",
  ),
  reword(
    "fx:05tuh",
    "5P5B0a0bu9s",
    "Il est parmi les premiers retranchés, et Snake parle d'un choix gaspillé. Selon lui, c'était déjà l'avis général le soir du repêchage, et l'avenir va le confirmer.",
  ),
  reword(
    "fx:05wwg",
    "VXSwWpe4U6c",
    "Pour bâtir une équipe, Snake prend sans hésiter Hutson à 8,85 M$ plutôt que Quinn Hughes à 15 M$, car la valeur d'un joueur tient aussi à son contrat. Sa jeunesse ajoute à l'avantage.",
  ),
  reword(
    "name:lars hutson",
    "45l6RtgRSuo",
    "Snake ne le voit pas comme un joueur de la LNH : pour y arriver, il devrait dominer, ce qui est loin d'être le cas. Il est bien en deçà du niveau qu'avaient ses deux frères à son âge.",
  ),
  reword(
    "fx:04bdb",
    "ZUZKNSv9F5k",
    "Pour Snake, c'est une superstar : il crée quelque chose à chacune de ses présences, que ce soit une entrée de zone ou une série de feintes. Il admet que ses blessures répétées sont un facteur. Il juge aussi que son contrat à long terme est très avantageux pour les Devils.",
  ),
  reword(
    "fx:04amd",
    "YQzbaWnfz1M",
    "Classé 3e en 2019 et choix que Snake aurait fait pour le CH, Krebs l'avait séduit par ses mains et son agilité. Il l'aime encore et le croit capable de tenir un rôle de milieu d'alignement avec une vraie chance, ce que Buffalo ne lui donne pas. Il ferait une offre modeste pour l'acquérir comme projet à risque.",
  ),
  reword(
    "fx:02azg",
    "W0WFdgy7eWY",
    "Snake trouve très bon le contrat de Brodin (6 M$ jusqu'en 2028) et le compte dans le noyau du Wild. C'est un coanimateur, et non Snake, qui le range parmi les défenseurs les moins reconnus de la LNH.",
  ),
  reword(
    "fx:04bih",
    "_WwDdBMXZW0",
    "La saison précédente, il avait fait un travail correct, sans plus, comme gardien auxiliaire. Cette saison, il est vraiment mauvais et coûte des défaites. Un gardien qui fait l'arrêt clé change l'issue des matchs, ce qui n'arrive pas avec lui.",
  ),
  reword(
    "name:doug wickenheiser",
    "GwRfgvo3amM",
    "Pour Snake, Wickenheiser illustre la surévaluation. Repêché après sa saison de 18 ans, ses 170 points dans l'Ouest ont gonflé sa cote. Grand et gros mais lent dans l'exécution, il n'a jamais percé, même aux côtés de Lafleur. L'avoir choisi devant Denis Savard figure parmi les pires erreurs jamais commises au repêchage.",
  ),
  reword(
    "fx:060jl",
    "eZH-m72X6vU",
    "Snake pense que Kulich pourrait être offert sur le marché, sans en être certain. À 18 ans, sa saison dans la Ligue américaine a été remarquable, une production presque inédite à cet âge. À 19 ans, après une grosse première moitié de saison, il a ralenti après les Fêtes, peut-être à cause d'une blessure.",
  ),
  reword(
    "fx:06rnr",
    "NGqH4GanpfM",
    "Centre très intéressant de 6 pieds 4, capable de marquer et de faire des jeux : 30 buts, 32 passes, un point par match à 17 ans. Il le projette comme joueur de milieu d'alignement dans la LNH, ce qui justifie ce rang. Il fera probablement une autre saison junior. Si le Canadien pouvait le cueillir au 28e rang, ce serait selon lui un très bon coup.",
  ),
  reword(
    "fx:05k8c",
    "CRx-muzeirQ",
    "C'était son choix de 2020 à la place de Guhle, et il ne revient pas sur sa décision. Foerster progresse et deviendra une pièce maîtresse d'un top 6. C'est un ailier robuste capable de marquer, le genre d'ailier de puissance que recherchent les équipes championnes.",
  ),
  reword(
    "fx:06h8h",
    "uY3swBRd5t0",
    "Snake dit bien connaître Connelly, qu'il appelle son chum. Selon lui, depuis environ un mois et demi, peu de joueurs de la Ligue américaine sont à son niveau, et peut-être aucun. Le passage souligne aussi ses 45 points en 43 matchs à 19 ans.",
  ),
  reword(
    "fx:06h8h",
    "VJUqDveOUP0",
    "C'est son plus grand coup de cœur. Snake est convaincu que Connelly jouera dans la LNH dès l'an prochain. Depuis environ deux mois, aucun joueur de la Ligue américaine ne le surpasse et il domine presque chaque match. Snake doutait seulement de sa fragilité. À Providence, un système hermétique l'étouffait. À Henderson, il fait des jeux spectaculaires.",
  ),
  reword(
    "fx:05rfa",
    "lud1JG4vVPw",
    "Sa première saison en NCAA a été une catastrophe, puis il a connu une grosse saison. Snake le voit toutefois devenir un joueur de soutien, comme on peut l'attendre d'un choix de fin de 1re ronde.",
  ),
  reword(
    "fx:02f9l",
    "6ilobJH6eRo",
    "Snake rappelle que MacKinnon aura 31 ans en septembre. Toujours excellent, il arrive toutefois à un âge où la fenêtre de l'Avalanche se referme peu à peu, même s'il reste un peu de temps.",
  ),
  reword(
    "fx:03ra7",
    "HgDIvZcpmsQ",
    "Pour Snake, quand il est en santé, Werenski fait partie de l'élite des défenseurs de la LNH. Il est sous contrat jusqu'en 2028.",
  ),
  reword(
    "fx:003tl",
    "a9xP7lxKlm8",
    "Il l'avait classé 10e, alors qu'il a été repêché 61e. Il lui prédisait un rôle de 3e trio, et c'est ce qu'il a eu, avec même plus de production que prévu. Énergique, fort physiquement, acharné dans les coins, il réussissait aussi de beaux jeux. Son coup de patin un peu bizarre ne l'empêchait pas de faire le travail.",
  ),
  reword(
    "fx:05w9c",
    "1-WIubIvgu0",
    "Numéro 1 de son top 15 U23, choisi de justesse devant Schaefer après une nuit d'hésitation. Pour Snake, c'est un joueur générationnel. À 16-17 ans, on le décrivait comme un joueur complet à la Toews, pas comme un gros marqueur. Il a pourtant 79 points dans une équipe qui marque peu, et sans lui les Sharks ne seraient pas dans la course aux séries. Snake ne l'attendait pas aussi fort dès cette saison.",
  ),
  reword(
    "fx:05w9c",
    "n13UL8StpZg",
    "Snake se sert de Celebrini comme point de comparaison pour Hagens. L'année précédente, contre la même équipe, Celebrini dominait des joueurs plus vieux alors qu'il était, à 17 ans, le plus jeune sur la glace.",
  ),
  reword(
    "fx:04mv2",
    "KQ0WviwCKEU",
    "C'est un marqueur né, et il pourrait très bien connaître au moins une autre saison de 50 buts avant la fin de sa carrière. Son taux de réussite d'environ 20 % était un peu élevé. S'il redescend à une quarantaine de buts, ce sera un ajustement statistique normal et non un déclin.",
  ),
  reword(
    "fx:04amg",
    "XVGbJI1rB0c",
    "Il a été un peu bloqué chez les Rangers, équipe de milieu de peloton arrivée au premier rang grâce à la loterie, mais il n'a pas non plus su s'imposer. Un peu des deux, selon lui.",
  ),
  reword(
    "fx:05xrx",
    "_8h2cTkl0YY",
    "Un joueur qui a déçu Snake. L'an dernier, il le croyait en train de se relancer, mais Kasper éprouve encore beaucoup de difficultés, même si Snake concède qu'il est encore jeune.",
  ),
  reword(
    "fx:06nkc",
    "_8h2cTkl0YY",
    "Snake le range parmi les tout meilleurs joueurs actuels de l'OHL; il n'y retournera pas l'an prochain.",
  ),
  reword(
    "fx:031of",
    "3rDtI3zh2so",
    "Pour Snake, Carrier est depuis sept ou huit ans le meilleur joueur de quatrième trio de la LNH. Son trio avec Jankowski et Robinson produit près de 30 buts par saison, un total énorme pour un quatrième trio.",
  ),
  reword(
    "fx:02nom",
    "4vwaKgXivOs",
    "Pendant quelques années, aucun gardien de la LNH ne l'a surpassé, ce qui donne l'avantage aux choix tardifs du Lightning en 2012. Snake dit l'avoir classé 2e à l'époque, sans préciser dans quelle liste. Selon lui, avoir deux choix a permis à Tampa de prendre le risque d'un gardien au premier tour.",
  ),
  reword(
    "fx:06axe",
    "zReYRICNTqc",
    "Snake préfère de loin Perreault à Ryan Leonard, pourtant choisi une quinzaine de rangs plus tôt. Il le trouve plus habile offensivement et c'est lui qu'il voudrait dans son équipe.",
  ),
  reword(
    "fx:05u4d",
    "lymho8pHbXI",
    "Snake croit que Trudeau reviendra. Mais comme le Canadien ne l'a jamais rappelé en trois ans, il aurait intérêt à tâter le terrain ailleurs, car c'est un bon défenseur de la Ligue américaine. Son style défensif lui donne, selon Snake, plus de chances de percer vers 24 ou 25 ans qu'un petit défenseur porteur de rondelle.",
  ),
  reword(
    "name:patrik stefan",
    "9gJpTZxFzPw",
    "Snake juge le repêchage de 1999 très faible. Il rappelle que Stefan, le premier choix, est surtout resté célèbre pour un filet désert raté, une des séquences les plus embarrassantes qu'ait connues le hockey.",
  ),
  reword(
    "name:bob macmillan",
    "HzvzlOK_6Js",
    "Pour Snake, aucun joueur de 100 points dans l'histoire n'a été aussi ordinaire. Ses 108 points de 1978-79 sont une aberration, puisqu'il n'a jamais approché ce niveau dans ses autres saisons.",
  ),
  reword(
    "fx:02un4",
    "n-r5u2-s78g",
    "Pour Snake, la vitesse d'exécution de McDavid est sans équivalent dans l'histoire, sauf peut-être chez Pavel Bure. Dès 2015, il le voyait devenir le plus grand joueur de l'histoire.",
  ),
  reword(
    "fx:06r63",
    "NGqH4GanpfM",
    "Il aime beaucoup ce centre et son choix d'aller jouer en NCAA à 17 ans contre des joueurs plus vieux. Meilleur joueur de la USHL à son retour de blessure, il a eu une adaptation difficile à Boston (7 points en 18 matchs), mais il s'est nettement amélioré de janvier à mars. Il a le talent, surtout comme fabricant de jeu.",
  ),
  reword(
    "fx:01c12",
    "EZpv80AyNII",
    "Il l'a toujours vu comme un joueur complémentaire : à Toronto, Matthews et Marner sont les locomotives, et 11 M$ pour un complément, c'est cher. Contrairement à Sakic, il n'a pas le calibre pour être le joueur numéro un d'une équipe championne, ce qui explique en partie les années sans séries des Islanders.",
  ),
  reword(
    "fx:068yz",
    "xXES33ICbRU",
    "Pour Snake, tout va bien pour le gardien, qui devrait s'entendre sur un contrat en fin de saison. La défaite de la fin de semaine ne l'inquiète pas : ce n'est qu'un match.",
  ),
  reword(
    "fx:06c91",
    "5P5B0a0bu9s",
    "Considéré comme le meilleur gardien du junior russe la saison précédente, il montera d'un échelon. La Russie est une pépinière de gardiens. Même s'il est loin derrière les autres gardiens du CH, Snake pense qu'il faut le garder à l'œil.",
  ),
  reword(
    "fx:061a1",
    "clbyPpd328o",
    "Snake croit qu'Engstrom commencera la saison à Montréal. Son expérience le place pour l'instant devant Reinbacher, sans faire de lui un meilleur espoir à long terme.",
  ),
  reword(
    "fx:064r2",
    "45l6RtgRSuo",
    "Pour Snake, le Canadien n'a pas repêché d'attaquant aussi talentueux que Demidov depuis Guy Lafleur en 1971. Sa créativité passe par des passes derrière le dos et des feintes rarement vues au Centre Bell, un style différent de celui de Lafleur.",
  ),
  reword(
    "fx:064wm",
    "ZV8PZCVnD3M",
    "S'il atteint la LNH, Snake voit Gauthier comme un joueur de bottom 6 : il ne lui voit pas le potentiel offensif d'un top 6. Il aura sans doute besoin d'au moins deux saisons dans la LAH. Il a toutefois du caractère et pourrait rendre service dans un rôle de 3e ou de 4e trio.",
  ),
  reword(
    "fx:02o8b",
    "4noUD4VED-E",
    "Sans le détester, il le voit comme un petit joueur de complément dont Toronto n'avait pas besoin, avec déjà plusieurs piliers de petit gabarit. Pour lui, c'était une erreur de construction.",
  ),
  reword(
    "fx:06gk0",
    "XVGbJI1rB0c",
    "Arrivé dans une équipe de milieu de peloton, il n'a pas été freiné, car il a gagné sa place : à 18 ans, il avait déjà le plus gros temps de jeu de l'équipe, et il le méritait.",
  ),
  reword(
    "fx:06ay2",
    "zGRxBw4gBjo",
    "Snake en fait un exemple de statistiques gonflées dans la WHL. Malgré 90 points à 19 ans, il joue une 2e saison avec le club-école des Sharks, sans garantie de jouer dans la LNH. Son petit gabarit n'est pas le seul frein : Snake doute qu'il soit assez élite pour y jouer en avantage numérique.",
  ),
  reword(
    "fx:05r1i",
    "tdUwHct4Eao",
    "C'est le principal espoir non repêché à surveiller. Il aura sans doute un rôle important avec les Américains et devrait être choisi dans le top 10 en 2021.",
  ),
  reword(
    "fx:02wy1",
    "dk6fIpMgYyo",
    "Au Colorado, il renaît et devient enfin le joueur que Marc Bergevin pensait obtenir, après des années difficiles à Montréal.",
  ),
  reword(
    "fx:02wy1",
    "U1zn_dqQwuA",
    "Au midget, il le voyait comme un solide espoir aux habiletés exceptionnelles. Sa seule réserve était physique : Drouin se faisait facilement bousculer. Il ne l'a jamais vu comme un centre : pour lui, Drouin est un ailier, et le faire jouer au centre était une erreur.",
  ),
  reword(
    "fx:05gd7",
    "CRx-muzeirQ",
    "Il a été impressionné de le voir passer directement de la USHL à la LNH à 18 ans. Après un début canon, il a connu une très mauvaise 2e saison. Il doute qu'il atteigne le niveau attendu d'un joueur choisi à ce rang, et il sonderait le marché pour l'échanger.",
  ),
  reword(
    "fx:05tqu",
    "Sm16y6S6qB8",
    "Avant le repêchage, Snake le projetait au mieux en 6e défenseur. Il admet s'être potentiellement trompé : Mailloux pourrait viser un rôle dans le top 4, même si l'échantillon reste mince. Ce ne sera pas un grand défenseur offensif. Il a amélioré sa prise de décision et sa vitesse de réflexion dans sa zone, et profite d'une brigade faible à St. Louis.",
  ),
  reword(
    "fx:05tqu",
    "3yBJFgCChZI",
    "Il souhaite que le Canadien s'en départe cet été, avant que sa valeur ne s'effondre complètement. Des équipes voient peut-être encore quelque chose dans son gros physique et son gros lancer, mais il n'est même plus sur la 1re unité d'avantage numérique à Laval. Snake rappelle qu'il l'a toujours dit.",
  ),
  reword(
    "fx:05ymo",
    "N4iZdkjKSig",
    "Beck a connu un meilleur début que fin de saison. Snake l'a toujours vu comme un centre de 4e trio, peut-être dans un ou deux ans, en rappelant qu'un attaquant doit percer vite en LNH sinon il est remplacé.",
  ),
  reword(
    "fx:01f5z",
    "C0ZYFRVjXQU",
    "Selon Snake, son arrivée renforce le top 6 du CH par rapport à la saison précédente. Reste à voir avec qui il aura de la chimie; il pourrait changer de trio. Il le voit plutôt sur la 2e unité d'avantage numérique, sans exclure mieux. Il n'est plus celui d'il y a cinq ou six ans, mais il reste rapide.",
  ),
  {
    key: "fx:01f5z",
    vid: "3vZm324Dlm8",
    set: {
      weaknesses: [
        "a perdu de son niveau d'il y a cinq ou six ans",
        "a paru fatigué avant la pause olympique",
        "probablement limité à la 2e unité de l'avantage numérique",
      ],
    },
    wording: true,
  },
  reword(
    "fx:06r5z",
    "WM_g42WNJwA",
    "Snake le voit comme un espoir du top 3 de 2026, doté de tous les outils pour faire carrière dans la LNH. Grand (6 pi 4, plus de 200 lb), structuré et solide défensivement, il fait une bonne première passe. Reste à savoir s'il sera un producteur de points. Il n'est pas dans la classe de Schaefer et se dessine plutôt comme un défenseur de 20-25 minutes.",
  ),
  reword(
    "name:patrice lefebvre",
    "WM_g42WNJwA",
    "Pour Snake, aucun joueur n'a marqué autant que lui dans l'histoire de la LHJMQ. Il a connu des saisons de 179 et 200 points, un record qu'il croit imbattable avec le jeu actuel. Il a dominé la LIH pendant six ans. Ignoré à cause de sa petite taille, il est tombé à la mauvaise époque, celle de la trappe (dead puck era).",
  ),
];

export type SynthesisPatch = Partial<
  Pick<SourceSynthesis, "syntheseFr" | "contradictions" | "projection" | "forces" | "faiblesses" | "comparables">
>;

/** Hand-rewritten synthesis fields (verbatim guard), by source player key. */
export const SNAKE_SYNTHESIS_CORRECTIONS: Readonly<Record<string, SynthesisPatch>> = {
  // One-opinion syntheses that repeat the opinion reworded above.
  "fx:05kj6": {
    syntheseFr:
      "Snake en fait un joueur « 4A », comme au baseball : trop fort pour la LAH, où il produira beaucoup, mais pas assez pour la LNH. Selon lui, il manque de force physique pour soutenir une saison de 82 matchs à pleine intensité, et son talent ne compense pas son gabarit.",
  },
  "name:lars hutson": {
    syntheseFr:
      "Snake ne le voit pas comme un joueur de la LNH : pour y arriver, il devrait dominer, ce qui est loin d'être le cas. Il est bien en deçà du niveau qu'avaient ses deux frères à son âge.",
  },
  "fx:003tl": {
    syntheseFr:
      "Il l'avait classé 10e, alors qu'il a été repêché 61e. Il lui prédisait un rôle de 3e trio, et c'est ce qu'il a eu, avec même plus de production que prévu. Énergique, fort physiquement, acharné dans les coins, il réussissait aussi de beaux jeux. Son coup de patin un peu bizarre ne l'empêchait pas de faire le travail.",
  },
  "name:bob macmillan": {
    syntheseFr:
      "Pour Snake, aucun joueur de 100 points dans l'histoire n'a été aussi ordinaire. Ses 108 points de 1978-79 sont une aberration, puisqu'il n'a jamais approché ce niveau dans ses autres saisons.",
  },
  "name:patrice lefebvre": {
    syntheseFr:
      "Pour Snake, aucun joueur n'a marqué autant que lui dans l'histoire de la LHJMQ. Il a connu des saisons de 179 et 200 points, un record qu'il croit imbattable avec le jeu actuel. Il a dominé la LIH pendant six ans. Ignoré à cause de sa petite taille, il est tombé à la mauvaise époque, celle de la trappe (dead puck era).",
  },
  "name:doug wickenheiser": {
    syntheseFr:
      "Joueur historique (1er choix du Canadien en 1980). Pour Snake, c'est l'exemple même de la surévaluation : une année de plus au junior et 170 points dans l'Ouest ont gonflé sa cote. Grand mais lent dans l'exécution, il n'a jamais percé, même avec Lafleur. L'avoir choisi devant Denis Savard figure parmi les pires erreurs jamais commises au repêchage.",
  },
};

/** Hand-rewritten ranking labels (verbatim guard), by `videoId|source title`. */
export const SNAKE_RANKING_TITLE_CORRECTIONS: Readonly<Record<string, string>> = {
  "9wlzp3C-9yc|Top 5 des équipes ayant le mieux manœuvré pour l'avenir à la date limite 2025 (classement d'ÉQUIPES, pas de joueurs)":
    "Top 5 des équipes les mieux placées pour l'avenir après la date limite des transactions 2025 (un classement d'équipes, pas de joueurs)",
};

/** `key|vid` → correction. */
export function opinionCorrectionIndex(
  list: readonly SnakeOpinionCorrection[] = SNAKE_OPINION_CORRECTIONS,
): Map<string, SnakeOpinionCorrection> {
  return new Map(list.map((c) => [`${c.key}|${c.vid}`, c]));
}
