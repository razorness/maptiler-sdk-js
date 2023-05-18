import type { Map, SymbolLayerSpecification } from 'maplibre-gl';

/**
 * Languages. Note that not all the languages of this list are available but the compatibility list may be expanded in the future.
 */
const Language = {
  /**
   * AUTO mode uses the language of the browser
   */
  AUTO: "auto",

  /**
   * STYLE is a custom flag to keep the language of the map as defined into the style.
   * If STYLE is set in the constructor, then further modification of the language
   * with `.setLanguage()` is not possible.
   */
  STYLE_LOCK: "style_lock",

  /**
   * Default fallback languages that uses latin charaters
   */
  LATIN: "latin",

  /**
   * Default fallback languages that uses non-latin charaters
   */
  NON_LATIN: "nonlatin",

  /**
   * Labels are in their local language, when available
   */
  LOCAL: "",

  ALBANIAN: "sq",
  AMHARIC: "am",
  ARABIC: "ar",
  ARMENIAN: "hy",
  AZERBAIJANI: "az",
  BASQUE: "eu",
  BELORUSSIAN: "be",
  BOSNIAN: "bs",
  BRETON: "br",
  BULGARIAN: "bg",
  CATALAN: "ca",
  CHINESE: "zh",
  CORSICAN: "co",
  CROATIAN: "hr",
  CZECH: "cs",
  DANISH: "da",
  DUTCH: "nl",
  ENGLISH: "en",
  ESPERANTO: "eo",
  ESTONIAN: "et",
  FINNISH: "fi",
  FRENCH: "fr",
  FRISIAN: "fy",
  GEORGIAN: "ka",
  GERMAN: "de",
  GREEK: "el",
  HEBREW: "he",
  HINDI: "hi",
  HUNGARIAN: "hu",
  ICELANDIC: "is",
  INDONESIAN: "id",
  IRISH: "ga",
  ITALIAN: "it",
  JAPANESE: "ja",
  JAPANESE_HIRAGANA: "ja-Hira",
  JAPANESE_KANA: "ja_kana",
  JAPANESE_LATIN: "ja_rm",
  JAPANESE_2018: "ja-Latn",
  KANNADA: "kn",
  KAZAKH: "kk",
  KOREAN: "ko",
  KOREAN_LATIN: "ko-Latn",
  KURDISH: "ku",
  ROMAN_LATIN: "la",
  LATVIAN: "lv",
  LITHUANIAN: "lt",
  LUXEMBOURGISH: "lb",
  MACEDONIAN: "mk",
  MALAYALAM: "ml",
  MALTESE: "mt",
  NORWEGIAN: "no",
  OCCITAN: "oc",
  POLISH: "pl",
  PORTUGUESE: "pt",
  ROMANIAN: "ro",
  ROMANSH: "rm",
  RUSSIAN: "ru",
  SCOTTISH_GAELIC: "gd",
  SERBIAN_CYRILLIC: "sr",
  SERBIAN_LATIN: "sr-Latn",
  SLOVAK: "sk",
  SLOVENE: "sl",
  SPANISH: "es",
  SWEDISH: "sv",
  TAMIL: "ta",
  TELUGU: "te",
  THAI: "th",
  TURKISH: "tr",
  UKRAINIAN: "uk",
  WELSH: "cy",
} as const;

const languagesIsoSet = new Set(Object.values(Language) as Array<string>);

function isLanguageSupported(lang: string): boolean {
  return languagesIsoSet.has(lang);
}

const languageCodeSet = new Set(Object.values(Language));

/**
 * Type representing the key of the Language object
 */
type LanguageKey = keyof typeof Language;

type Values<T> = T[keyof T];

/**
 * Built-in languages values as strings
 */
type LanguageString = Values<typeof Language>;

function getBrowserLanguage(): LanguageString {
  if (typeof navigator === "undefined") {
    return Intl.DateTimeFormat()
      .resolvedOptions()
      .locale.split("-")[0] as LanguageString;
  }

  const canditatelangs = Array.from(
    new Set(navigator.languages.map((l) => l.split("-")[0]))
  ).filter((l) => languageCodeSet.has(l as LanguageString));

  return canditatelangs.length
    ? (canditatelangs[0] as LanguageString)
    : Language.LATIN;
}

export function setPrimaryLanguage(map: Map, language: string) {

  const layers = map.getStyle().layers;

  // detects pattern like "{name:somelanguage}" with loose spacing
  const strLanguageRegex = /^\s*{\s*name\s*(:\s*(\S*))?\s*}$/;

  // detects pattern like "name:somelanguage" with loose spacing
  const strLanguageInArrayRegex = /^\s*name\s*(:\s*(\S*))?\s*$/;

  // for string based bilingual lang such as "{name:latin}  {name:nonlatin}" or "{name:latin}  {name}"
  const strBilingualRegex =
        /^\s*{\s*name\s*(:\s*(\S*))?\s*}(\s*){\s*name\s*(:\s*(\S*))?\s*}$/;

  // Regex to capture when there are more info, such as mountains elevation with unit m/ft
  const strMoreInfoRegex = /^(.*)({\s*name\s*(:\s*(\S*))?\s*})(.*)$/;

  const langStr = language ? `name:${language}` : "name"; // to handle local lang
  const replacer = [
    "case",
    ["has", langStr],
    ["get", langStr],
    ["get", "name"],
  ];

  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i] as SymbolLayerSpecification;
    const layout = layer.layout;

    if (!layout) {
      continue;
    }

    if (!layout["text-field"]) {
      continue;
    }

    const textFieldLayoutProp = map.getLayoutProperty(
      layer.id,
      "text-field"
    );

    // Note:
    // The value of the 'text-field' property can take multiple shape;
    // 1. can be an array with 'concat' on its first element (most likely means bilingual)
    // 2. can be an array with 'get' on its first element (monolingual)
    // 3. can be a string of shape '{name:latin}'
    // 4. can be a string referencing another prop such as '{housenumber}' or '{ref}'
    //
    // The case 1, 2 and 3 will be updated while maintaining their original type and shape.
    // The case 3 will not be updated

    let regexMatch;

    // This is case 1
    if (
      Array.isArray(textFieldLayoutProp) &&
      textFieldLayoutProp.length >= 2 &&
      textFieldLayoutProp[0].trim().toLowerCase() === "concat"
    ) {
      const newProp = textFieldLayoutProp.slice(); // newProp is Array
      // The style could possibly have defined more than 2 concatenated language strings but we only want to edit the first
      // The style could also define that there are more things being concatenated and not only languages

      for (let j = 0; j < textFieldLayoutProp.length; j += 1) {
        const elem = textFieldLayoutProp[j];

        // we are looking for an elem of shape '{name:somelangage}' (string) of `["get", "name:somelanguage"]` (array)

        // the entry of of shape '{name:somelangage}', possibly with loose spacing
        if (
          (typeof elem === "string" || elem instanceof String) &&
          strLanguageRegex.exec(elem.toString())
        ) {
          newProp[j] = replacer;
          break; // we just want to update the primary language
        }
        // the entry is of an array of shape `["get", "name:somelanguage"]`
        else if (
          Array.isArray(elem) &&
          elem.length >= 2 &&
          elem[0].trim().toLowerCase() === "get" &&
          strLanguageInArrayRegex.exec(elem[1].toString())
        ) {
          newProp[j] = replacer;
          break; // we just want to update the primary language
        } else if (
          Array.isArray(elem) &&
          elem.length === 4 &&
          elem[0].trim().toLowerCase() === "case"
        ) {
          newProp[j] = replacer;
          break; // we just want to update the primary language
        }
      }

      map.setLayoutProperty(layer.id, "text-field", newProp);
    }

    // This is case 2
    else if (
      Array.isArray(textFieldLayoutProp) &&
      textFieldLayoutProp.length >= 2 &&
      textFieldLayoutProp[0].trim().toLowerCase() === "get" &&
      strLanguageInArrayRegex.exec(textFieldLayoutProp[1].toString())
    ) {
      const newProp = replacer;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    }

    // This is case 3
    else if (
      (typeof textFieldLayoutProp === "string" ||
        textFieldLayoutProp instanceof String) &&
      strLanguageRegex.exec(textFieldLayoutProp.toString())
    ) {
      const newProp = replacer;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    } else if (
      Array.isArray(textFieldLayoutProp) &&
      textFieldLayoutProp.length === 4 &&
      textFieldLayoutProp[0].trim().toLowerCase() === "case"
    ) {
      const newProp = replacer;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    } else if (
      (typeof textFieldLayoutProp === "string" ||
        textFieldLayoutProp instanceof String) &&
      (regexMatch = strBilingualRegex.exec(
        textFieldLayoutProp.toString()
      )) !== null
    ) {
      const newProp = `{${langStr}}${regexMatch[3]}{name${
        regexMatch[4] || ""
      }}`;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    } else if (
      (typeof textFieldLayoutProp === "string" ||
        textFieldLayoutProp instanceof String) &&
      (regexMatch = strMoreInfoRegex.exec(
        textFieldLayoutProp.toString()
      )) !== null
    ) {
      const newProp = `${regexMatch[1]}{${langStr}}${regexMatch[5]}`;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    }
  }

}

export function setSecondaryLanguage(map: Map, language: string) {

  const layers = map.getStyle().layers;

  // detects pattern like "{name:somelanguage}" with loose spacing
  const strLanguageRegex = /^\s*{\s*name\s*(:\s*(\S*))?\s*}$/;

  // detects pattern like "name:somelanguage" with loose spacing
  const strLanguageInArrayRegex = /^\s*name\s*(:\s*(\S*))?\s*$/;

  // for string based bilingual lang such as "{name:latin}  {name:nonlatin}" or "{name:latin}  {name}"
  const strBilingualRegex =
            /^\s*{\s*name\s*(:\s*(\S*))?\s*}(\s*){\s*name\s*(:\s*(\S*))?\s*}$/;

  let regexMatch;

  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i] as SymbolLayerSpecification;
    const layout = layer.layout;

    if (!layout) {
      continue;
    }

    if (!layout["text-field"]) {
      continue;
    }

    const textFieldLayoutProp = map.getLayoutProperty(
        layer.id,
        "text-field"
    );

    let newProp;

    // Note:
    // The value of the 'text-field' property can take multiple shape;
    // 1. can be an array with 'concat' on its first element (most likely means bilingual)
    // 2. can be an array with 'get' on its first element (monolingual)
    // 3. can be a string of shape '{name:latin}'
    // 4. can be a string referencing another prop such as '{housenumber}' or '{ref}'
    //
    // Only the case 1 will be updated because we don't want to change the styling (read: add a secondary language where the original styling is only displaying 1)

    // This is case 1
    if (
        Array.isArray(textFieldLayoutProp) &&
        textFieldLayoutProp.length >= 2 &&
        textFieldLayoutProp[0].trim().toLowerCase() === "concat"
    ) {
      newProp = textFieldLayoutProp.slice(); // newProp is Array
      // The style could possibly have defined more than 2 concatenated language strings but we only want to edit the first
      // The style could also define that there are more things being concatenated and not only languages

      let languagesAlreadyFound = 0;

      for (let j = 0; j < textFieldLayoutProp.length; j += 1) {
        const elem = textFieldLayoutProp[j];

        // we are looking for an elem of shape '{name:somelangage}' (string) of `["get", "name:somelanguage"]` (array)

        // the entry of of shape '{name:somelangage}', possibly with loose spacing
        if (
            (typeof elem === "string" || elem instanceof String) &&
            strLanguageRegex.exec(elem.toString())
        ) {
          if (languagesAlreadyFound === 1) {
            newProp[j] = `{name:${language}}`;
            break; // we just want to update the secondary language
          }

          languagesAlreadyFound += 1;
        }
        // the entry is of an array of shape `["get", "name:somelanguage"]`
        else if (
            Array.isArray(elem) &&
            elem.length >= 2 &&
            elem[0].trim().toLowerCase() === "get" &&
            strLanguageInArrayRegex.exec(elem[1].toString())
        ) {
          if (languagesAlreadyFound === 1) {
            newProp[j][1] = `name:${language}`;
            break; // we just want to update the secondary language
          }

          languagesAlreadyFound += 1;
        } else if (
            Array.isArray(elem) &&
            elem.length === 4 &&
            elem[0].trim().toLowerCase() === "case"
        ) {
          if (languagesAlreadyFound === 1) {
            newProp[j] = ["get", `name:${language}`]; // the situation with 'case' is supposed to only happen with the primary lang
            break; // but in case a styling also does that for secondary...
          }

          languagesAlreadyFound += 1;
        }
      }

      map.setLayoutProperty(layer.id, "text-field", newProp);
    }

    // the language (both first and second) are defined into a single string model
    else if (
        (typeof textFieldLayoutProp === "string" ||
            textFieldLayoutProp instanceof String) &&
        (regexMatch = strBilingualRegex.exec(
            textFieldLayoutProp.toString()
        )) !== null
    ) {
      const langStr = language ? `name:${language}` : "name"; // to handle local lang
      newProp = `{name${regexMatch[1] || ""}}${regexMatch[3]}{${langStr}}`;
      map.setLayoutProperty(layer.id, "text-field", newProp);
    }
  }

}

export {
  Language,
  getBrowserLanguage,
  isLanguageSupported,
};

export type {
  LanguageString,
  LanguageKey,
}
