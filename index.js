import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import markdownit from 'markdown-it';
import shiki from '@shikijs/markdown-it';
import { full as emoji } from 'markdown-it-emoji';

/* I don't find the markdownit docs particularly good...
Processes the content as a stream of tokens, it parses out blocks and inline
elements. For inline and block elements it assigns a type (e.g. code_inline,
code_block, fence). It then applies a rule (function) to output HTML for that
element/type. 

For example, 4 spaces on a newline signifies a code block, markdownit flags
this as a code_block element, and applies a rule rendering the escaped content
into <pre><code> tags. Backticks `` signify inline-code, markdownit flags
this as a code_inline element, and applies a rule rendering the escaped content
into <code> tags.

Fences are ``` or ~~~

Syntax highlighting.
- you can use a highlight function below. 

HOW IS THE data-highlighted tag added? Why does calling highlight here not
result in class="language-python hljs" when running highlightAll in the
browser does?


*/

const md = markdownit({
    // Wrap url-like strings in hrefs
    linkify: true,
    // Specify whether or not to pass through html
    // e.g. if <h1>testing</h1> is included in the markdown
    // html: True will pass this through as HTML, and render it
    // as an h1. html: False will treat this as text and wrap it in a <p>
    // default is false
    html: false,
    // Apply a highlighting function
    // Only applies to fences (``` or ~~~)
    // You can add lang next to the top of the fence and it will be passed
    // as lang here (e.g. ```python ... ```)
    // We use highlight.js's highlight() here
    // If highlight returns a <pre>... block that's returned, otherwise
    // the returned value is wrapped in <pre><code>
    // then you need to style the code / pre code blocks or use highlight's default
    // style sheet
    // Highlight uses the lang to parse the content and mark things as keywords, builtins, strings
    // etc. Then, theme css files style keywords, strings, etc
    // highlight: function (str, lang) {
    //   if (lang && hljs.getLanguage(lang)) {
    //     try {
    //       return hljs.highlight(str, { language: lang }).value;
    //     } catch (__) {}
    //   }
    //   return ''; // use external default escaping
    // }
})
.use(emoji)
.use(await shiki({
        themes: {
            light: 'everforest-light'
        }
    })
); // use the emoji plugin to parse :emoji: and render the emoji

// For each md file, open the template, open a new html file
// read template and write to knew until you find
// the injection point, then write the rendered html, then write
// the remaining template
function splitContent(content, delineator) {
    const [meta, ...tmp] = content.split(delineator);
    // only the first split matters, rejoin other occurrences of delineator
    const markdown = tmp.join(delineator).trim();
    const metaMap = new Map(meta.trim().split('\n').map(kv => kv.split(':')));
    return [metaMap, markdown]; 
};

function parseMdFiles(paths, delineator) {
    const mdDetails = [];
    for (const mdPath of paths) {
        let data;
        try {
            data = fs.readFileSync(mdPath, 'utf8'); 
        } catch (err) {
            console.error(err);
            throw err
        }
        const [metaMap, markdown] = splitContent(data, delineator);
        const html = md.render(markdown);
        // console.debug(html);
        mdDetails.push([mdPath, metaMap, html])
    }
    return mdDetails
};

function injectIntoTemplate(templateHtml, replaceTag, contentHtml) {
    return templateHtml.replace(replaceTag, contentHtml);
};

function getMdFilesFromDir(dir, draftDir) {
    const extension = '.md';
    // It's a bit easier to filter out includes(draftdir) after we've resolved
    // the full path, because dirent.parentPath doesn't end with a trailing /
    // for recursive items
    const nonDraftMdFiles = fs.readdirSync(dir, { recursive: true, withFileTypes: true})
        .filter(dirent =>  !dirent.isDirectory() && dirent.name.endsWith(extension))
        .map(dirent => path.join(dirent.parentPath, dirent.name))
        .filter(fileName => !fileName.includes(draftDir));
    return nonDraftMdFiles;
};

function makeOutputDir(sourceDir, outputDirName) {
    fs.mkdirSync(sourceDir + outputDirName, { recursive: true });
} 

function readTemplateFile(templateFilePath) {
    try {
        return fs.readFileSync(templateFilePath, 'utf8');
    } catch (err) {
        console.error(err);
        throw err
    }
};

function sourcePathToBuildPath(sourcePath, buildDir, itemInSource) {
    return sourcePath.replace(itemInSource, `${buildDir}/${itemInSource}`) 
};

function parseDate(dateStr) {
    return new Date(dateStr).toISOString().split('T')[0] 
};

function createArticles(aboutTemplate, template, buildDir, mdDetails) {
    for (const [mdPath, metaMap, mdHtml] of mdDetails) {
        const fileName = path.basename(mdPath, path.extname(mdPath));
        const withContent = injectIntoTemplate(template, "{{ content }}", mdHtml);
        const title = metaMap.get('title') ?? toTitleCase(fileName.replaceAll('_', ' '));
        const withTitle = injectIntoTemplate(withContent, "{{ title }}", title);
        const pubDate = metaMap.get('published_date') ? parseDate(metaMap.get('published_date')) : '';
        const withDate = injectIntoTemplate(withTitle, "{{ published_date }}", pubDate);
        const lmDate = metaMap.get('last_modified_date') ? parseDate(metaMap.get('last_modified_date')) : pubDate;
        const compiledHtml = injectIntoTemplate(withDate, "{{ last_modified_date }}", lmDate);
        let pathInBuild = '';
        let fileOutputDir = '';
        if (fileName === 'about') {
            // about should be top-level
            pathInBuild = sourcePathToBuildPath(mdPath, buildDir, 'content/').replace('content/', '')
        } else {
            pathInBuild = sourcePathToBuildPath(mdPath, buildDir, 'content/'); 
        }
        fileOutputDir = path.dirname(pathInBuild) + '/' + fileName.replaceAll('_', '-') + '/';
        fs.mkdirSync(fileOutputDir)
        fs.writeFile(fileOutputDir + 'index.html' , compiledHtml, {flag: 'w+'}, err => {
            if (err) {
                console.error(err);
            } else {
                console.log(`HTML file written successfully for ${fileName}.`);
            }
        });
    };
};

function toTitleCase(str) {
    return str.replace(
      /\w\S*/g,
      text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
    );
  }

function addArticles(template, contentDir, mdDetails) {
    const articlesPerYear = new Map();
    for (const [mdPath, metaMap, _mdHTML] of mdDetails) {
        const fileName = path.basename(mdPath, path.extname(mdPath));
        if (fileName === 'about') {
            continue;
        }
        const title = metaMap.get('title') ?? toTitleCase(fileName.replaceAll('_', ' '));
        const articleBullet = `<li class="article-bullet ${metaMap.get('tags')}"><a href="${contentDir}/${fileName.replaceAll('_', '-')}/">${title}</a></li>`;
        const pubDate = metaMap.get('published_date') ? parseDate(metaMap.get('published_date')) : '';
        if (!pubDate) {
            throw new TypeError(`Must include a published_date tag for article ${title}`);
        }
        const pubYear = pubDate.split('-')[0];
        if (articlesPerYear.has(pubYear)) {
            articlesPerYear.get(pubYear).push( {'pubDate': pubDate, 'article': articleBullet} );
        } else {
            articlesPerYear.set(pubYear, [ {'pubDate': pubDate, 'article': articleBullet} ]);
        }
    }
    const sortedArticlesPerYear = new Map([...articlesPerYear].sort().reverse())
    // TODO: Sort articles within year by date
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#sorting_array_of_objects
    // make 2024: [{date: li}, {date: li}, ...]
    let yearsArticles = ''
    for (const [year, bullets] of sortedArticlesPerYear) {
        const bulletsByDate = bullets.sort((d1, d2) => new Date(d2.pubDate) - new Date(d1.pubDate)) // desc 
        let articles = ''
        for (const dateBullet of bulletsByDate) {
            articles += dateBullet.article
        }
        yearsArticles +=
        `<div class="article-year-set">
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
    };  
    return injectIntoTemplate(template, '{{ articles }}', yearsArticles);
};

// Now, build the index.html with a list of content
function createHomepage(template, sourceDir, contentDir, buildDir, mdDetails) {
    const compiledHtml = addArticles(template, contentDir, mdDetails)
    // const withBullets = addBullets(template, contentDir, mdDetails)
    // const compiledHtml = addFilters(withBullets, mdDetails)
    fs.writeFile(sourcePathToBuildPath(sourceDir + 'index.html', buildDir, 'index.html'), compiledHtml, {flag: 'w+'}, err => {
        if (err) {
            console.error(err);
        } else {
            console.log('index.html file written successfully.');
        }
    });
};

function copyToBuild(resourcePath, resourceName, buildDir) {
    fs.cpSync(resourcePath, sourcePathToBuildPath(resourcePath, buildDir, resourceName), { recursive: true})
}

function generateStaticSite() {
    const args = process.argv.slice(2);
    const delineator = '---';
    const sourceDir = args[0];
    // const sourceDir = '/Users/agmazzuckelli/Documents/code/super_simple_ssg/source/' // should be a full path, build/ will be relative to it
    const contentSuffix = 'content';
    const draftSuffix = 'drafts';
    const buildSuffix = 'build';
    const assetsSuffix = 'assets';
    const contentTemplatePath = sourceDir + 'templates/article-template.html';
    const homepageTemplatePath = sourceDir + 'templates/homepage-template.html';
    const aboutTemplatePath = sourceDir + 'templates/about-template.html'
    const aboutPage = 'about/index.html';
    // within a sourceDir, expect named items:
    // content/, assets/, templates/, about.html
    const contentDir = sourceDir + contentSuffix + '/';
    const contentMdFiles = getMdFilesFromDir(contentDir, contentDir + draftSuffix + '/');
    const mdDetails = parseMdFiles(contentMdFiles, delineator);
    // Clear then reinitialize output dirs
    fs.rmSync(sourceDir + buildSuffix + '/', { force: true, recursive: true });
    makeOutputDir(sourceDir, `${buildSuffix}/${contentSuffix}/`)
    // Make articles and homepage in build
    const contentTemplate = readTemplateFile(contentTemplatePath);
    const aboutTemplate = readTemplateFile(aboutTemplatePath);
    createArticles(aboutTemplate, contentTemplate, buildSuffix, mdDetails);
    const homepageTemplate = readTemplateFile(homepageTemplatePath);
    createHomepage(homepageTemplate, sourceDir, contentSuffix, buildSuffix, mdDetails);
    // Copy assets/ and about to build
    copyToBuild(sourceDir + assetsSuffix + '/', assetsSuffix, buildSuffix); // TODO: Delete build/ before repopulating (could rsync --delete to only update new)
}

generateStaticSite()





// TODO
// Clean up the syntax highlighting / markdown update notes
// Clean up the path stuff, it's awful
// Clean up the filename / title stuff - happening in multiple places