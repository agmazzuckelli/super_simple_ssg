import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import markdownit from 'markdown-it';

const md = markdownit();

// For each md file, open the template, open a new html file
// read template and write to knew until you find
// the injection point, then write the rendered html, then write
// the remaining template
function splitContent(content, delineator) {
    const [meta, markdown] = content.split(delineator).map(elem => elem.trim());
    const metaMap = new Map(meta.split('\n').map(kv => kv.split(':')));
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

function createArticles(template, buildDir, mdDetails) {
    for (const [mdPath, _metaMap, mdHtml] of mdDetails) {
        const fileName = path.basename(mdPath, path.extname(mdPath));
        const withContent = injectIntoTemplate(template, "{{ content }}", mdHtml);
        const title = _metaMap.get('title') ?? toTitleCase(fileName);
        const withTitle = injectIntoTemplate(withContent, "{{ title }}", title);
        const date = _metaMap.get('date') ?? '';
        const compiledHtml = injectIntoTemplate(withTitle, "{{ date }}", date);
        fs.writeFile(`${sourcePathToBuildPath(mdPath, buildDir, 'content/').replace('.md', '.html')}`, compiledHtml, {flag: 'w+'}, err => {
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

function addBullets(template, contentDir, mdDetails) {
    let articleList = '';
    for (const [mdPath, metaMap, _mdHtml] of mdDetails) {
        const fileName = path.basename(mdPath, path.extname(mdPath));
        const title = metaMap.get('title') ?? toTitleCase(fileName)
        articleList += `<li class="article-bullet ${metaMap.get('tags')}"><a href="${contentDir}/${fileName}.html">${title}</a></li>`;
    };
    return injectIntoTemplate(template, '{{ article-bullets }}', articleList)
};

function addFilters(template, mdDetails) {
    let filterList = '';
    const allTags = new Set();
    for (const [_mdPath, metaMap, _mdHTML] of mdDetails) {
        const contentTags = metaMap.get('tags').split(',').map(tag=>tag.trim());
        for (const tag of contentTags) {
            if (!allTags.has(tag)) {
                filterList += `<div class="filters__filter">
                                  <input type="checkbox" role="switch" aria-checked="true" class="filters__filter--${tag}" name="${tag}-filter" id="${tag}-filter">
                                  <label for="${tag}-filter">${toTitleCase(tag)}</label>
                             </div>`;
                allTags.add(tag);
            };
        };
    };
    return injectIntoTemplate(template, '{{ filters }}', filterList)
};

// Now, build the index.html with a list of content
function createHomepage(template, sourceDir, contentDir, buildDir, mdDetails) {
    const withBullets = addBullets(template, contentDir, mdDetails)
    const compiledHtml = addFilters(withBullets, mdDetails)
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
    const aboutPage = 'about.html';
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
    createArticles(contentTemplate, buildSuffix, mdDetails);
    const homepageTemplate = readTemplateFile(homepageTemplatePath);
    createHomepage(homepageTemplate, sourceDir, contentSuffix, buildSuffix, mdDetails);
    // Copy assets/ and about to build
    copyToBuild(sourceDir + assetsSuffix + '/', assetsSuffix, buildSuffix); // TODO: Delete build/ before repopulating (could rsync --delete to only update new)
    copyToBuild(sourceDir + aboutPage, aboutPage, buildSuffix)
}

generateStaticSite()
