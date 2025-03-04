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

type ArticleDetail = Map<string, string>;
type ArticleDetails = ArticleDetail[];
/** Read and parse each file in paths.
 *
 * @param paths - Array of paths, each of which is a markdown file to parse
 * @returns undefined. But, sets the global article details map with each article's
 * path, raw HTML, and metadata
 */
function parseMdFiles(paths: string[]): undefined {
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
    metaMap.set("mdHtml", html);
    metaMap.set("mdPath", mdPath);
    mdDetails.push(metaMap);
  }
  ARTICLEDETAILS = mdDetails;
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

/** Write a file with content to fileOutputDir/. */
function writeFile(
  fileOutputDir: string,
  fileName: string,
  content: string,
): undefined {
  fs.writeFile(
    path.join(fileOutputDir, fileName),
    content,
    { flag: "w" },
    (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log(`${fileName} written successfully at ${fileOutputDir}.`);
      }
    },
  );
}

/** Write an index.html file with compiledHtml to fileOutputDir/. */
function writeIndexFile(
  fileOutputDir: string,
  compiledHtml: string,
): undefined {
  writeFile(fileOutputDir, INDEX_FILE, compiledHtml);
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
function createArticles(): undefined {
  for (const article of ARTICLEDETAILS) {
    // Hydrate HTML
    const mdPath = article.get("mdPath")!;
    const fileName = path.basename(mdPath, path.extname(mdPath));
    const title =
      article.get("title") ?? toTitleCase(fileName.replaceAll("_", " "));
    let pubDate = "1900-01-01";
    if (!article.has("published_date")) {
      console.warn(
        `Article: ${title} is missing a published_date tag. Using 1900-01-01.`,
      );
    } else {
      pubDate = parseDate(article.get("published_date")!);
    }
    const lmDate = article.get("last_modified_date")
      ? parseDate(article.get("last_modified_date")!)
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
      .replace("{{ content }}", article.get("mdHtml")!)
      .replace("{{ title }}", title)
      .replace("{{ published_date }}", pubDate)
      .replace("{{ last_modified_date }}", lmDate);

    // Write out to filename/index.html (good URLS shouldn't change)
    let fileUri;
    if (fileName === "about") {
      fileUri = fileName;
    } else {
      fileUri = path.join(
        SETTINGS.contentDirectory,
        fileName.replaceAll("_", "-"),
      );
    }
    const fileOutputDir = path.join(TARGETDIR, fileUri)
    fs.mkdirSync(fileOutputDir, { recursive: true });
    writeIndexFile(fileOutputDir, compiledHtml);
    // Update article's global details
    article.set("fileName", fileName);
    article.set("normTitle", title);
    article.set("normPubDate", pubDate);
    article.set("normLastModifiedDate", lmDate);
    article.set("compiledHtml", compiledHtml);
    article.set("uri", fileUri)
  }
}

/** Compile homepage html and write out. */
function createHomepage(): undefined {
  // Hydrate HTML
  const articlesPerYear = new Map();
  for (const article of ARTICLEDETAILS) {
    if (article.get("fileName") === "about") {
      continue;
    }
    const articleBullet = `<li class="article-bullet ${article.get("tags")}">
                            <a href="${SETTINGS.contentDirectory}/${article.get("fileName")!.replaceAll("_", "-")}/">${article.get("normTitle")}</a>
                           </li>`;
    const pubDate = article.get("normPubDate")!;
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

type Entry = {entry_xml: string, entryDate: string};
function createEntry(article: ArticleDetail): Entry {
  const published = new Date(article.get("normPubDate")!).toISOString();
  const updated = new Date(article.get("normLastModifiedDate")!).toISOString();
  const articleLink = path.join(SETTINGS.siteName, article.get("uri")!)
  return {
    entry_xml: `<entry>
      <title>${article.get("normTitle")}</title>
      <id>${articleLink}/</id>
      <link rel="alternate" href="/${article.get("uri")}/"/>
      <published>${published}</published>
      <updated>${updated}</updated>
      <summary>${article.get("normTitle")}</summary>
    </entry>`,
    entryDate: updated
  }
}

function createFeed(): undefined {
  const entries = [];
  for (const a of ARTICLEDETAILS) {
    const entry = createEntry(a);
    entries.push(entry);
  }
  // Sort entries by last updated
  entries.sort(
    (e1: Entry, e2: Entry) =>
      +new Date(e2.entryDate) - +new Date(e1.entryDate)
  );
  const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="${SETTINGS.siteName}/" xml:lang="en-US">
<title>Y5x Feed</title>
<id>${SETTINGS.siteName}/</id>
<link rel="alternate" href="${SETTINGS.siteName}/"/>
<link rel="self" href="${path.join(SETTINGS.siteName, "feed")}/"/>
<updated>${new Date().toISOString()}</updated>
<author>
  <name>AGM</name>
  <email>whyfivetimes@gmail.com</email>
</author>
${entries.map(e=>e.entry_xml).join('\n')}
</feed>`;
  const fileOutputDir = path.join(TARGETDIR, "feed")
  fs.mkdirSync(fileOutputDir, { recursive: true });
  writeFile(fileOutputDir, "feed.atom", feed);
}

/** Generate a static site given a directory containing inputs.
 *
 * Inputs would typically include directories of content and assets.
 */
function generateStaticSite(): undefined {
  initOutputDir();
  const relevantMdFiles = getMdFiles();
  parseMdFiles(relevantMdFiles);
  createArticles();
  createHomepage();
  createFeed();
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
  // site base
  siteName: "https://whyfivetimes.com",
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
/** Global article details map. */
let ARTICLEDETAILS: ArticleDetails;

/** Generate the static site. */
function main(): undefined {
  parseArgs();
  generateStaticSite();
}

main();
