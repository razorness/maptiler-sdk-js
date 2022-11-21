import * as maplibre from "maplibre-gl";
import { config } from "./config";
import { defaults } from "./defaults";
import { CustomLogoControl } from "./CustomLogoControl";
import { enableRTL, expandMapStyle, vlog } from "./tools";
import { getBrowserLanguage, Language, LanguageString } from "./language";
import { isBuiltinStyle, prepareBuiltinStyle, StyleString } from "./style";

// StyleSwapOptions is not exported by Maplibre, but we can redefine it (used for setStyle)
export type TransformStyleFunction = (
  previous: maplibre.StyleSpecification,
  next: maplibre.StyleSpecification
) => maplibre.StyleSpecification;

export type StyleSwapOptions = {
  diff?: boolean;
  transformStyle?: TransformStyleFunction;
};

/**
 * Options to provide to the `Map` constructor
 */
export type MapOptions = Omit<maplibre.MapOptions, "style" | "maplibreLogo"> & {
  /**
   * Style of the map. Can be:
   * - a full style URL (possibly with API key)
   * - a shorthand with only the MapTIler style name (eg. `"streets-v2"`)
   * - a longer form with the prefix `"maptiler://"` (eg. `"maptiler://streets-v2"`)
   */
  style?: string;

  /**
   * Shows the MapTiler logo if `true`. Note that the logo is always displayed on free plan.
   */
  maptilerLogo?: boolean;

  /**
   * Enables 3D terrain if `true`. (default: `false`)
   */
  enableTerrain?: boolean;

  /**
   * Exaggeration factor of the terrain. (default: `1`, no exaggeration)
   */
  terrainExaggeration?: number;
};

/**
 * The Map class can be instanciated to display a map in a `<div>`
 */
export class Map extends maplibre.Map {
  private languageShouldUpdate = false;
  private isStyleInitialized = false;
  private isTerrainEnabled = false;
  private terrainExaggeration = 1;

  constructor(options: MapOptions) {
    let style;

    if ("style" in options) {
      if (typeof style === "string" && isBuiltinStyle(style)) {
        style = prepareBuiltinStyle(style as StyleString, config.apiKey);
      } else if (typeof style === "string") {
        style = expandMapStyle(style);
      } else {
        style = options.style;
      }
    } else {
      style = expandMapStyle(defaults.mapStyle);
      vlog(`Map style not provided, backing up to ${defaults.mapStyle}`);
    }

    // calling the map constructor with full length style
    super({ ...options, style, maplibreLogo: false });

    // Check if language has been modified and. If so, it will be updated during the next lifecycle step
    this.on("styledataloading", () => {
      this.languageShouldUpdate =
        !!config.primaryLanguage || !!config.secondaryLanguage;
    });

    // If the config includes language changing, we must update the map language
    this.on("styledata", () => {
      if (
        config.primaryLanguage &&
        (this.languageShouldUpdate || !this.isStyleInitialized)
      ) {
        this.setPrimaryLanguage(config.primaryLanguage);
      }

      if (
        config.secondaryLanguage &&
        (this.languageShouldUpdate || !this.isStyleInitialized)
      ) {
        this.setSecondaryLanguage(config.secondaryLanguage);
      }

      this.languageShouldUpdate = false;
      this.isStyleInitialized = true;
    });

    // this even is in charge of reaplying the terrain elevation after the
    // style has changed because depending on the src/tgt style,
    // the style logic is not always able to resolve the application of terrain
    this.on("styledata", () => {
      // the styling resolver did no manage to reaply the terrain,
      // so let's reload it
      if (this.getTerrain() === null && this.isTerrainEnabled) {
        this.enableTerrain(this.terrainExaggeration);
      }
    });

    // load the Right-to-Left text plugin (will happen only once)
    this.once("load", async () => {
      enableRTL();
    });

    // Update logo and attibution
    this.once("load", async () => {
      let tileJsonURL = null;
      try {
        tileJsonURL = (
          this.getSource("openmaptiles") as maplibre.VectorTileSource
        ).url;
      } catch (e) {
        return;
      }

      const tileJsonRes = await fetch(tileJsonURL);
      const tileJsonContent = await tileJsonRes.json();

      // The attribution and logo must show when required
      if ("logo" in tileJsonContent && tileJsonContent.logo) {
        const logoURL: string = tileJsonContent.logo;

        this.addControl(
          new CustomLogoControl({ logoURL }),
          options.logoPosition
        );

        // if attribution in option is `false` but the the logo shows up in the tileJson, then the attribution must show anyways
        if (options.attributionControl === false) {
          this.addControl(new maplibre.AttributionControl(options));
        }
      } else if (options.maptilerLogo) {
        this.addControl(new CustomLogoControl(), options.logoPosition);
      }
    });

    // enable 3D terrain if provided in options
    if (options.enableTerrain) {
      this.enableTerrain(options.terrainExaggeration ?? 1);
    }
  }

  /**
   * Update the style of the map.
   * Can be:
   * - a full style URL (possibly with API key)
   * - a shorthand with only the MapTIler style name (eg. `"streets-v2"`)
   * - a longer form with the prefix `"maptiler://"` (eg. `"maptiler://streets-v2"`)
   * @param style
   * @param options
   * @returns
   */
  setStyle(
    style: maplibre.StyleSpecification | string | null,
    options?: StyleSwapOptions & maplibre.StyleOptions
  ) {
    let tempStyle = style;

    if (typeof style === "string" && isBuiltinStyle(style)) {
      tempStyle = prepareBuiltinStyle(style as StyleString, config.apiKey);
    } else if (typeof style === "string") {
      tempStyle = expandMapStyle(style);
    }

    return super.setStyle(tempStyle, options);
  }

  /**
   * Define the primary language of the map. Note that not all the languages shorthands provided are available.
   * This function is a short for `.setPrimaryLanguage()`
   * @param language
   */
  setLanguage(language: LanguageString = defaults.primaryLanguage) {
    if (language === Language.AUTO) {
      return this.setLanguage(getBrowserLanguage());
    }
    this.setPrimaryLanguage(language);
  }

  /**
   * Define the primary language of the map. Note that not all the languages shorthands provided are available.
   * @param language
   */
  setPrimaryLanguage(language: LanguageString = defaults.primaryLanguage) {
    if (language === Language.AUTO) {
      return this.setPrimaryLanguage(getBrowserLanguage());
    }

    console.log("language", language);

    // We want to keep track of it to apply the language again when changing the style
    config.primaryLanguage = language;

    const layers = this.getStyle().layers;

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
      ["get", "name:latin"],
    ];

    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const layout = layer.layout;

      if (!layout) {
        continue;
      }

      if (!layout["text-field"]) {
        continue;
      }

      const textFieldLayoutProp = this.getLayoutProperty(
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

        this.setLayoutProperty(layer.id, "text-field", newProp);
      }

      // This is case 2
      else if (
        Array.isArray(textFieldLayoutProp) &&
        textFieldLayoutProp.length >= 2 &&
        textFieldLayoutProp[0].trim().toLowerCase() === "get" &&
        strLanguageInArrayRegex.exec(textFieldLayoutProp[1].toString())
      ) {
        const newProp = replacer;
        this.setLayoutProperty(layer.id, "text-field", newProp);
      }

      // This is case 3
      else if (
        (typeof textFieldLayoutProp === "string" ||
          textFieldLayoutProp instanceof String) &&
        strLanguageRegex.exec(textFieldLayoutProp.toString())
      ) {
        const newProp = replacer;
        this.setLayoutProperty(layer.id, "text-field", newProp);
      } else if (
        Array.isArray(textFieldLayoutProp) &&
        textFieldLayoutProp.length === 4 &&
        textFieldLayoutProp[0].trim().toLowerCase() === "case"
      ) {
        const newProp = replacer;
        this.setLayoutProperty(layer.id, "text-field", newProp);
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
        this.setLayoutProperty(layer.id, "text-field", newProp);
      } else if (
        (typeof textFieldLayoutProp === "string" ||
          textFieldLayoutProp instanceof String) &&
        (regexMatch = strMoreInfoRegex.exec(textFieldLayoutProp.toString())) !==
          null
      ) {
        const newProp = `${regexMatch[1]}{${langStr}}${regexMatch[5]}`;
        this.setLayoutProperty(layer.id, "text-field", newProp);
      }
    }
  }

  /**
   * Define the secondary language of the map.
   * Note that most styles do not allow a secondary language and this function only works if the style allows (no force adding)
   * @param language
   */
  setSecondaryLanguage(language: LanguageString = defaults.secondaryLanguage) {
    if (language === Language.AUTO) {
      return this.setSecondaryLanguage(getBrowserLanguage());
    }

    // We want to keep track of it to apply the language again when changing the style
    config.secondaryLanguage = language;

    const layers = this.getStyle().layers;

    // detects pattern like "{name:somelanguage}" with loose spacing
    const strLanguageRegex = /^\s*{\s*name\s*(:\s*(\S*))?\s*}$/;

    // detects pattern like "name:somelanguage" with loose spacing
    const strLanguageInArrayRegex = /^\s*name\s*(:\s*(\S*))?\s*$/;

    // for string based bilingual lang such as "{name:latin}  {name:nonlatin}" or "{name:latin}  {name}"
    const strBilingualRegex =
      /^\s*{\s*name\s*(:\s*(\S*))?\s*}(\s*){\s*name\s*(:\s*(\S*))?\s*}$/;

    let regexMatch;

    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const layout = layer.layout;

      if (!layout) {
        continue;
      }

      if (!layout["text-field"]) {
        continue;
      }

      const textFieldLayoutProp = this.getLayoutProperty(
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

        this.setLayoutProperty(layer.id, "text-field", newProp);
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
        this.setLayoutProperty(layer.id, "text-field", newProp);
      }
    }
  }

  /**
   * Enables the 3D terrain visualization
   * @param exaggeration
   * @returns
   */
  enableTerrain(exaggeration = 1) {
    const terrainInfo = this.getTerrain();

    const addTerrain = () => {
      // When style is changed,
      this.isTerrainEnabled = true;
      this.terrainExaggeration = exaggeration;

      this.addSource(defaults.terrainSourceId, {
        type: "raster-dem",
        url: `${defaults.terrainSourceURL}?key=${config.apiKey}`,
      });
      this.setTerrain({
        source: defaults.terrainSourceId,
        exaggeration: exaggeration,
      });
    };

    // The terrain has already been loaded,
    // we just update the exaggeration.
    if (terrainInfo) {
      this.setTerrain({ ...terrainInfo, exaggeration });
      return;
    }

    if (this.loaded() || this.isTerrainEnabled) {
      addTerrain();
    } else {
      this.once("load", () => {
        if (this.getTerrain() && this.getSource(defaults.terrainSourceId)) {
          return;
        }
        addTerrain();
      });
    }
  }

  /**
   * Disable the 3D terrain visualization
   */
  disableTerrain() {
    this.isTerrainEnabled = false;
    this.setTerrain(null);
    if (this.getSource(defaults.terrainSourceId)) {
      this.removeSource(defaults.terrainSourceId);
    }
  }

  /**
   * Sets the 3D terrain exageration factor.
   * Note: this is only a shortcut to `.enableTerrain()`
   * @param exaggeration
   */
  setTerrainExaggeration(exaggeration: number) {
    this.enableTerrain(exaggeration);
  }

  // getLanguages() {
  //   const layers = this.getStyle().layers;

  //   for (let i = 0; i < layers.length; i += 1) {
  //     const layer = layers[i];
  //     const layout = layer.layout;

  //     if (!layout) {
  //       continue;
  //     }

  //     if (!layout["text-field"]) {
  //       continue;
  //     }

  //     const textFieldLayoutProp = this.getLayoutProperty(
  //       layer.id,
  //       "text-field"
  //     );
  //   }
  // }
}