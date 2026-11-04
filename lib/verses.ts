/**
 * Verses shown one-per-day on the Dashboard and on the sign-in page.
 *
 * Chosen for their bearing on stewardship, seva and honest accounting — the work
 * this app is actually used for. Translations here are plain-English renderings
 * written for this app rather than reproductions of a published translation; the
 * citation is given so anyone can look up the verse in full with its purport.
 */
export type Verse = {
  /** Devanagari, one line per pada-pair. */
  sa: string;
  /** IAST transliteration. */
  iast: string;
  /** Plain-English rendering. */
  en: string;
  /** Where to look it up. */
  ref: string;
};

export const VERSES: Verse[] = [
  {
    sa: "ईशावास्यमिदं सर्वं यत्किञ्च जगत्यां जगत्\nतेन त्यक्तेन भुञ्जीथा मा गृधः कस्यस्विद्धनम्",
    iast: "īśāvāsyam idaṁ sarvaṁ yat kiñca jagatyāṁ jagat\ntena tyaktena bhuñjīthā mā gṛdhaḥ kasya svid dhanam",
    en: "Everything in this world belongs to the Lord. Take only what is set aside for you, and do not covet what belongs to another.",
    ref: "Śrī Īśopaniṣad, Mantra 1",
  },
  {
    sa: "यत्करोषि यदश्नासि यज्जुहोषि ददासि यत्\nयत्तपस्यसि कौन्तेय तत्कुरुष्व मदर्पणम्",
    iast: "yat karoṣi yad aśnāsi yaj juhoṣi dadāsi yat\nyat tapasyasi kaunteya tat kuruṣva mad-arpaṇam",
    en: "Whatever you do, whatever you eat, whatever you offer or give away — do it, O son of Kuntī, as an offering to Me.",
    ref: "Bhagavad-gītā 9.27",
  },
  {
    sa: "दातव्यमिति यद्दानं दीयतेऽनुपकारिणे\nदेशे काले च पात्रे च तद्दानं सात्त्विकं स्मृतम्",
    iast: "dātavyam iti yad dānaṁ dīyate 'nupakāriṇe\ndeśe kāle ca pātre ca tad dānaṁ sāttvikaṁ smṛtam",
    en: "Charity given as a matter of duty, with nothing expected in return, at the right place and time and to a worthy person, is charity in goodness.",
    ref: "Bhagavad-gītā 17.20",
  },
  {
    sa: "यज्ञार्थात्कर्मणोऽन्यत्र लोकोऽयं कर्मबन्धनः\nतदर्थं कर्म कौन्तेय मुक्तसङ्गः समाचर",
    iast: "yajñārthāt karmaṇo 'nyatra loko 'yaṁ karma-bandhanaḥ\ntad-arthaṁ karma kaunteya mukta-saṅgaḥ samācara",
    en: "Work done as an offering to the Lord does not bind. Therefore do your work for His sake, free from attachment.",
    ref: "Bhagavad-gītā 3.9",
  },
  {
    sa: "पत्रं पुष्पं फलं तोयं यो मे भक्त्या प्रयच्छति\nतदहं भक्त्युपहृतमश्नामि प्रयतात्मनः",
    iast: "patraṁ puṣpaṁ phalaṁ toyaṁ yo me bhaktyā prayacchati\ntad ahaṁ bhakty-upahṛtam aśnāmi prayatātmanaḥ",
    en: "A leaf, a flower, a fruit, a little water — whatever is offered to Me with devotion by a pure heart, that I accept.",
    ref: "Bhagavad-gītā 9.26",
  },
  {
    sa: "यतः प्रवृत्तिर्भूतानां येन सर्वमिदं ततम्\nस्वकर्मणा तमभ्यर्च्य सिद्धिं विन्दति मानवः",
    iast: "yataḥ pravṛttir bhūtānāṁ yena sarvam idaṁ tatam\nsva-karmaṇā tam abhyarcya siddhiṁ vindati mānavaḥ",
    en: "By doing one's own work as worship of the Lord — from whom all beings come and by whom all this is pervaded — a person attains perfection.",
    ref: "Bhagavad-gītā 18.46",
  },
  {
    sa: "अनासक्तस्य विषयान् यथार्हमुपयुञ्जतः\nनिर्बन्धः कृष्णसम्बन्धे युक्तं वैराग्यमुच्यते",
    iast: "anāsaktasya viṣayān yathārham upayuñjataḥ\nnirbandhaḥ kṛṣṇa-sambandhe yuktaṁ vairāgyam ucyate",
    en: "To use things without attachment, exactly as they are needed, keeping their connection with Kṛṣṇa — that is called proper renunciation.",
    ref: "Bhakti-rasāmṛta-sindhu 1.2.255",
  },
  {
    sa: "अतः पुम्भिर्द्विजश्रेष्ठा वर्णाश्रमविभागशः\nस्वनुष्ठितस्य धर्मस्य संसिद्धिर्हरितोषणम्",
    iast: "ataḥ pumbhir dvija-śreṣṭhā varṇāśrama-vibhāgaśaḥ\nsvanuṣṭhitasya dharmasya saṁsiddhir hari-toṣaṇam",
    en: "The highest perfection of doing one's prescribed duty well is simply this: that the Lord is pleased by it.",
    ref: "Śrīmad-Bhāgavatam 1.2.13",
  },
  {
    sa: "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि",
    iast: "karmaṇy evādhikāras te mā phaleṣu kadācana\nmā karma-phala-hetur bhūr mā te saṅgo 'stv akarmaṇi",
    en: "You have a right to your work, never to its fruits. Do not act for the result, and do not be attached to inaction either.",
    ref: "Bhagavad-gītā 2.47",
  },
  {
    sa: "तृणादपि सुनीचेन तरोरिव सहिष्णुना\nअमानिना मानदेन कीर्तनीयः सदा हरिः",
    iast: "tṛṇād api su-nīcena taror iva sahiṣṇunā\namāninā māna-dena kīrtanīyaḥ sadā hariḥ",
    en: "Humbler than a blade of grass, more tolerant than a tree, offering respect to all and expecting none — in such a state one may chant the holy name constantly.",
    ref: "Śrī Śikṣāṣṭaka 3",
  },
  {
    sa: "श्रवणं कीर्तनं विष्णोः स्मरणं पादसेवनम्\nअर्चनं वन्दनं दास्यं सख्यमात्मनिवेदनम्",
    iast: "śravaṇaṁ kīrtanaṁ viṣṇoḥ smaraṇaṁ pāda-sevanam\narcanaṁ vandanaṁ dāsyaṁ sakhyam ātma-nivedanam",
    en: "Hearing and chanting about Viṣṇu, remembering Him, serving His feet, worshipping, praying, serving as a servant and a friend, and surrendering everything — these are the nine limbs of devotion.",
    ref: "Śrīmad-Bhāgavatam 7.5.23",
  },
  {
    sa: "ब्रह्मार्पणं ब्रह्म हविर्ब्रह्माग्नौ ब्रह्मणा हुतम्\nब्रह्मैव तेन गन्तव्यं ब्रह्मकर्मसमाधिना",
    iast: "brahmārpaṇaṁ brahma havir brahmāgnau brahmaṇā hutam\nbrahmaiva tena gantavyaṁ brahma-karma-samādhinā",
    en: "The offering is spiritual, the oblation is spiritual, and it is offered by a spiritual being into a spiritual fire — one absorbed in such work reaches the spiritual.",
    ref: "Bhagavad-gītā 4.24",
  },
];

/**
 * The same verse for everyone on a given day, rotating through the collection.
 * Takes a YYYY-MM-DD string so server and client agree and nothing re-renders
 * differently after hydration.
 */
export function verseOfTheDay(isoDate: string): Verse {
  const days = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86400000);
  return VERSES[((days % VERSES.length) + VERSES.length) % VERSES.length];
}
