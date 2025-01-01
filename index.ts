import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import markdownit from "markdown-it";
import shiki from "@shikijs/markdown-it";
import { full as emoji } from "markdown-it-emoji";

/* Parse .md documents */

/** Markdown to HTML rendering object. */
const md: markdownit = markdownit({
  // Turn url-like strings to hrefs
  linkify: true,
  // Leave HTML in MD as un-rendered HTML
  html: false,
})
  .use(emoji)
  .use(
    // Apply inline styles to code blocks 
    await shiki({
      themes: {
        light: "everforest-light",
      },
    }),
  );

/** Return non-ignored MD files from the target directory.
 *
 * @return Returns all files in SOURCEDIR with an extension matching
 * an extension in MD_ExTENSIONS. Ignores files in SETTINGS.ignoreDirectory
 */
function getMdFiles(): string[] {
  const nonDraftMdFiles = fs
    .readdirSync(path.join(SOURCEDIR, SETTINGS.contentDirectory), {
      recursive: true,
      withFileTypes: true,
    })
    .filter(
      (dirent) =>
        !dirent.isDirectory() && endsWithAny(dirent.name, MD_EXTENSIONS),
    )
    .map((dirent) => path.join(dirent.parentPath, dirent.name))
    .filter(
      (fileName) =>
        !fileName.includes(SETTINGS.ignoreDirectory) &&
        !fileName.includes(SETTINGS.outputDirectory), // outputDir is cleared before md files retrieved, but be safe
    );
  return nonDraftMdFiles;
}

/** Parse an MD file.
 *
 * Splits an MD file using SETTINGS.contentDelineator. Considers everything above
 * the first instance of the delineator as metadata and everything below as
 * content.
 * @param content - All contents of the MD file
 * @returns Returns (1) a Map of metadata - k, v pairs
 * of the items above the first instance of SETTINGS.contentDelineator, and
 * (2) a string of MD content.
 */
function splitContent(content: string): [Map<string, string>, string] {
  if (!content.includes(SETTINGS.contentDelineator)) {
    throw TypeError(`Files must include meta and content delineated by
                    ${SETTINGS.contentDelineator}.`);
  }
  const [meta, ...rest] = content.split(SETTINGS.contentDelineator);
  // Only the first split matters, rejoin other occurrences of delineator
  const markdown = rest.join(SETTINGS.contentDelineator).trim();
  const parsedMeta: string[][] = meta
    .trim()
    .split(SETTINGS.interKvDelineator)
    .map((kv) => kv.split(SETTINGS.intraKvDelineator).map((e) => e.trim()));
  if (parsedMeta.length === 1 && parsedMeta[0].length === 1) {
    return [new Map(), markdown];
  }
  // The operation above TS thinks is string[][] (e.g. possibly [[""]]) since
  // there could be no meta at all
  // or no intraKvDelineators to split by. We checked for that case, so ensured
  // at least one kv pair to pass to our map. Map() expects readonly kv pairs, so
  // we mark parsedMeta appropriately as [string, string] and assign to a readonly type
  const mapInput: readonly [string, string][] = parsedMeta as [
    string,
    string,
  ][];
  const metaMap = new Map(mapInput);
  return [metaMap, markdown];
}

type ArticleDetail = [string, Map<string, string>, string];
type ArticleDetails = ArticleDetail[];
/** Read and parse each file in paths.
 *
 * @param paths - Array of paths, each of which is a markdown file to parse
 * @returns Returns an array of tuples, one for
 * each md file (path). Each tuple contains the path, the file's metadata as a KV Map,
 * and the content rendered as HTML.
 */
function parseMdFiles(paths: string[]): ArticleDetails {
  const mdDetails = [];
  for (const mdPath of paths) {
    let data;
    try {
      data = fs.readFileSync(mdPath, "utf8");
    } catch (err) {
      console.error(err);
      throw err;
    }
    const [metaMap, markdown] = splitContent(data);
    const html = md.render(markdown);
    mdDetails.push([mdPath, metaMap, html] as ArticleDetail);
  }
  return mdDetails;
}

/* Handle filesystem operations */

/** Clear and create the target output directory. */
function initOutputDir(): undefined {
  fs.rmSync(TARGETDIR, { force: true, recursive: true });
  fs.mkdirSync(TARGETDIR);
}

/** Read in template HTML given a template path. */
function readTemplateFile(templateFilePath: string): string {
  try {
    return fs.readFileSync(templateFilePath, "utf8");
  } catch (err) {
    console.error(err);
    throw err;
  }
}

/** Write an index.html file with compiledHtml to fileOutputDir/. */
function writeIndexFile(
  fileOutputDir: string,
  compiledHtml: string,
): undefined {
  fs.writeFile(
    path.join(fileOutputDir, INDEX_FILE),
    compiledHtml,
    { flag: "w" },
    (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log(
          `index.html file written successfully at ${fileOutputDir}.`,
        );
      }
    },
  );
}

/* General Helpers */

/** Whether string ends with any item in a provided array. */
function endsWithAny(str: string, suffixes: string[]): boolean {
  for (const s of suffixes) {
    if (str.endsWith(s)) {
      return true;
    }
  }
  return false;
}

/** Title Case a string. The first letter of each word should be capitalized. */
function toTitleCase(str: string): string {
  return str.replace(
    /\w\S*/g,
    (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase(),
  );
}

/** Format dates in a consistent ISO style.
 * @param dateStr - date string to format.
 * @return Date in YYYY-MM-DD format.
 */
function parseDate(dateStr: string): string {
  return new Date(dateStr).toISOString().split("T")[0];
}

/* Create HTML */

/** Compile and write out an HTML file for each valid markdown file. */
function createArticles(articleDetails: ArticleDetails): undefined {
  for (const [mdPath, meta, html] of articleDetails) {
    // Hydrate HTML
    const fileName = path.basename(mdPath, path.extname(mdPath));
    const title =
      meta.get("title") ?? toTitleCase(fileName.replaceAll("_", " "));
    const pubDate = meta.get("published_date")
      ? parseDate(meta.get("published_date") as string)
      : "";
    const lmDate = meta.get("last_modified_date")
      ? parseDate(meta.get("last_modified_date") as string)
      : pubDate;
    let template;
    if (fileName === "about") {
      template = readTemplateFile(
        path.join(
          SOURCEDIR,
          SETTINGS.templateDirectory,
          SETTINGS.templates.about,
        ),
      );
    } else {
      template = readTemplateFile(
        path.join(
          SOURCEDIR,
          SETTINGS.templateDirectory,
          SETTINGS.templates.article,
        ),
      );
    }
    const compiledHtml = template
      .replace("{{ content }}", html)
      .replace("{{ title }}", title)
      .replace("{{ published_date }}", pubDate)
      .replace("{{ last_modified_date }}", lmDate);

    // Write out to filename/index.html (good URLS shouldn't change)
    let fileOutputDir;
    if (fileName === "about") {
      fileOutputDir = path.join(TARGETDIR, fileName.replaceAll("_", "-"));
    } else {
      fileOutputDir = path.join(
        TARGETDIR,
        SETTINGS.contentDirectory,
        fileName.replaceAll("_", "-"),
      );
    }
    fs.mkdirSync(fileOutputDir, { recursive: true });
    writeIndexFile(fileOutputDir, compiledHtml);
  }
}

/** Compile homepage html and write out. */
function createHomepage(articleDetails: ArticleDetails): undefined {
  // Hydrate HTML
  const articlesPerYear = new Map();
  for (const [mdPath, meta] of articleDetails) {
    const fileName = path.basename(mdPath, path.extname(mdPath));
    if (fileName === 'about') {
      continue;
    }
    const title =
      meta.get("title") ?? toTitleCase(fileName.replaceAll("_", " "));
    const articleBullet = `<li class="article-bullet ${meta.get("tags")}">
                            <a href="${SETTINGS.contentDirectory}/${fileName.replaceAll("_", "-")}/">${title}</a>
                           </li>`;
    const pubDate = meta.get("published_date")
      ? parseDate(meta.get("published_date") as string)
      : "";
    if (!pubDate) {
      throw new TypeError(
        `Must include a published_date tag for article ${title}`,
      );
    }
    const pubYear = pubDate.split("-")[0];
    if (articlesPerYear.has(pubYear)) {
      articlesPerYear
        .get(pubYear)
        .push({ pubDate: pubDate, articleBullet: articleBullet });
    } else {
      articlesPerYear.set(pubYear, [
        { pubDate: pubDate, articleBullet: articleBullet },
      ]);
    }
  }
  // make 2024: [{date: li}, {date: li}, ...]
  const sortedArticlesPerYear = new Map([...articlesPerYear].sort().reverse());
  type articleBullet = { pubDate: string; articleBullet: string };
  let yearsArticles = "";
  for (const [year, bullets] of sortedArticlesPerYear) {
    // sort within year
    const bulletsByDate = bullets.sort(
      // https://github.com/microsoft/TypeScript/issues/5710
      (d1: articleBullet, d2: articleBullet) =>
        +new Date(d2.pubDate) - +new Date(d1.pubDate),
    ); // desc
    let articles = "";
    for (const dateBullet of bulletsByDate) {
      articles += dateBullet.articleBullet;
    }
    yearsArticles += `<div class="article-year-set">
            <div class="article-year">
                <p>${year}</p>
            </div>
            <div class="article-bullets">
                <ul class="article-list">
                    ${articles}
                </ul> 
            </div>
            <div class="article-spacer">
            </div>
        </div>`;
  }
  // Write out
  const template = readTemplateFile(
    path.join(
      SOURCEDIR,
      SETTINGS.templateDirectory,
      SETTINGS.templates.homePage,
    ),
  );
  const compiledHtml = template.replace("{{ articles }}", yearsArticles);
  const fileOutputDir = TARGETDIR;
  writeIndexFile(fileOutputDir, compiledHtml);
}

/** Generate a static site given a directory containing inputs.
 *
 * Inputs would typically include directories of content and assets.
 */
function generateStaticSite(): undefined {
  initOutputDir();
  const relevantMdFiles = getMdFiles();
  const articleDetails = parseMdFiles(relevantMdFiles);
  createArticles(articleDetails);
  createHomepage(articleDetails);
  fs.cpSync(
    path.join(SOURCEDIR, SETTINGS.assetsDirectory),
    path.join(TARGETDIR, SETTINGS.assetsDirectory),
    { recursive: true },
  );
}

/** Parse CLI args.
 * @throws RangeError if a single CLI arg is not provided.
 */
function parseArgs(): undefined {
  if (process.argv.length !== 3 && process.argv.length !== 4) {
    throw RangeError(`Usage: npm run dev SOURCEDIR [TARGETDIR].
                      If TARGETDIR not given, TARGETDIR is
                      SOURCEDIR/SETTINGS.outputDirectory`);
  }
  SOURCEDIR = process.argv[2];
  TARGETDIR = path.join(SOURCEDIR, SETTINGS.outputDirectory);
}

/** Necessary settings for generating the static site output. */
const SETTINGS = {
  // input directory names
  contentDirectory: "content",
  ignoreDirectory: "drafts",
  assetsDirectory: "assets",
  // output directory name
  outputDirectory: "build",
  // templates
  templateDirectory: "templates",
  templates: {
    about: "about.html",
    article: "article.html",
    homePage: "homepage.html",
  },
  // MD parsing
  // Delineator in md files to split meta and content, used in splitContent
  contentDelineator: "---",
  intraKvDelineator: ":",
  interKvDelineator: "\n",
};

/** HTML file name for all site pages. */
const INDEX_FILE = "index.html";
/** Markdown extensions */
const MD_EXTENSIONS = [".md"];
/** Path from which to generate static content. */
let SOURCEDIR: string;
/** Path to output static content. */
let TARGETDIR: string;

/** Generate the static site. */
function main(): undefined {
  parseArgs();
  generateStaticSite();
}

main();
