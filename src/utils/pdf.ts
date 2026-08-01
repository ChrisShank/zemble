/* eslint-disable no-useless-escape */
import { config } from "../../package.json";

export type _ZoteroItem = any;

export type ItemBaseInfo = {
  identifiers: {
    DOI?: string;
    arXiv?: string;
    CNKI?: string;
    paperID?: string;
  };
  title: string;
  authors: string[];
  type?: "journalArticle" | "preprint" | string;
  text?: string;
  year?: string;
  url?: string;
  _item?: _ZoteroItem;
  _itemID?: number;
  number?: number;
  [key: string]: any;
};

export type ItemInfo = ItemBaseInfo & {
  publishDate?: string | number;
  abstract?: string | undefined;
  primaryVenue?: string;
  source?: string;
  tags?: (string[] | { text: string; color: string; tip?: string })[];
  references?: ItemBaseInfo[];
};

export class Utils {
  static cache: { [key: string]: any } = {};
  static regex = {
    DOI: /10\.\d{4,9}\/[-\._;\(\)\/:A-z0-9><]+[^\.\]]/,
    arXiv: /arXiv[\.:](\d+\.\d+)/,
    URL: /https?:\/\/[^\s\.]+/,
  };

  static getIdentifiers(text: string): ItemBaseInfo["identifiers"] {
    const targets = [
      {
        key: "DOI",
        ignoreSpace: true,
        regex: this.regex.DOI,
      },
      {
        key: "arXiv",
        ignoreSpace: true,
        regex: this.regex.arXiv,
      },
    ];
    const identifiers: any = {};
    for (const target of targets) {
      const res = (target.ignoreSpace ? text.replace(/\s+/g, "") : text).match(
        target.regex,
      );
      if (res) {
        identifiers[target.key] = res.slice(-1)[0];
      }
    }
    return identifiers;
  }

  static extractURL(text: string) {
    const res = text.match(this.regex.URL);
    if (res) {
      return res.slice(-1)[0];
    }
  }

  static parseRefText(text: string): {
    year?: string;
    authors?: string[];
    title: string;
    publicationVenue?: string;
  } {
    try {
      text = text.replace(/^\[\d+?\]/, "");
      text = text.replace(/\s+/g, " ");
      // 匹配标题
      // 引号引起来，100%是标题
      let title: string, titleMatch: string;
      if (/\u201c(.+)\u201d/.test(text)) {
        [titleMatch, title] = text.match(/\u201c(.+)\u201d/)!;
        if (title.endsWith(",")) {
          title = title.slice(0, -1);
        }
      } else {
        title = titleMatch = (
          (text.indexOf(". ") != -1 &&
            text.match(/\.\s/g)!.length >= 2 &&
            text.split(". ")) ||
          text.split(".")
        )
          // 找出最长的两个，其中一个最有可能是一堆作者，另一个最有可能是标题
          .sort((a, b) => b.length - a.length)
          // 统计它们中缩写以及符号出现的次数，出现次数最多的有可能是作者
          .map((s: string) => {
            let count = 0;
            [/[A-Z]\./g, /[,\.\-\(\)\:]/g, /\d/g].forEach((regex) => {
              const res = s.match(regex);
              count += res ? res.length : 0;
            });
            return [count / s.length, s];
          })
          // 过滤期刊描述
          .filter((s: any) => s[1].match(/\s+/g)?.length >= 3)
          .sort((a: any, b: any) => a[0] - b[0])![0][1] as string;
        if (/\[[A-Z]\]$/.test(title)) {
          title = title.replace(/\[[A-Z]\]$/, "");
        }
      }
      title = title.trim();
      const splitByTitle = text.split(titleMatch);
      let authorInfo = splitByTitle[0].trim();

      // ztoolkit.log(splitByTitle[1])

      const publicationVenue = splitByTitle[1]
        .match(/[^.\s].+[^\.]/)![0]
        .split(/[,\d]/)[0]
        .trim();
      if (authorInfo.indexOf("et al.") != -1) {
        authorInfo = authorInfo.split("et al.")[0] + "et al.";
      }
      const currentYear = new Date().getFullYear();
      const res = text
        .match(/[^\d]\d{4}[^\d-]/g)
        ?.map((s) => s.match(/\d+/)![0]);
      const year = (res || []).find((s) => {
        return Number(s) <= Number(currentYear) + 1;
      })!;
      authorInfo = authorInfo.replace(`${year}.`, "").replace(year, "").trim();
      return { year, title, authors: [authorInfo], publicationVenue };
    } catch {
      return {
        title: text,
      };
    }
  }

  static identifiers2URL(identifiers: ItemBaseInfo["identifiers"]) {
    let url;
    if (identifiers.DOI) {
      url = `https://doi.org/${identifiers.DOI}`;
    }
    if (identifiers.arXiv) {
      url = `https://arxiv.org/abs/${identifiers.arXiv}`;
    }
    return url;
  }

  static refText2Info(text: string): ItemBaseInfo {
    const identifiers = this.getIdentifiers(text);
    return {
      identifiers: identifiers,
      url: this.extractURL(text) || this.identifiers2URL(identifiers),
      authors: [],
      ...this.parseRefText(text),
      type: identifiers.arXiv ? "preprint" : "journalArticle",
    };
  }
}

export async function createItemByZotero(
  identifiers: ItemBaseInfo["identifiers"],
  collections: number[],
): Promise<Zotero.Item> {
  const translate = new Zotero.Translate.Search();
  translate.setIdentifier(identifiers);
  const translators = await translate.getTranslators();
  translate.setTranslator(translators);
  const libraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID();
  const items = await translate.translate({
    libraryID,
    collections,
    saveAttachments: true,
  });
  return items[0];
}

// From https://github.com/MuiseDestiny/zotero-reference/blob/bootstrap/src/modules/pdf.ts

type PDFLine = {
  x: number;
  _x?: number;
  y: number;
  text: string;
  height: number;
  _height: number[];
  width: number;
  url?: string;
  [key: string]: any;
};

type PDFItem = {
  chars: {
    baseline: number;
    c: string;
    fontName: string;
    fontSize: number;
    rect: number[];
    rotation: number;
  }[];
  dir: string;
  fontName: string;
  height: number;
  str: string;
  transform: number[];
  width: number;
  url?: string;
};

type PDFAnnotation = {
  rect: number[];
  url?: string;
  unsafeUrl?: string;
};

type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

class PDF {
  static refRegex: RegExp[][] = [
    [/^\(\d+\)\s?/], // (1)
    [/^\[\d{0,3}\].+?[\,\.\uff0c\uff0e]?/], // [10] Polygon
    [/^\uff3b\d{0,3}\uff3d.+?[\,\.\uff0c\uff0e]?/], // ［1］
    [/^\d+[\,\.\uff0c\uff0e]/], // 1. Polygon
    [/^\d+[^\d\w]+?[\,\.\uff0c\uff0e]?/], // 1. Polygon
    [/^\[.+?\].+?[\,\.\uff0c\uff0e]?/], // [RCK + 20]
    [/^\d+\s+/], // 1 Polygon
    [
      /^[A-Z]\w.+?\(\d+[a-z]?\)/,
      /^[A-Z][A-Za-z]+[\,\.\uff0c\uff0e]?/,
      /^.+?,.+.,/,
      /^[\u4e00-\u9fa5]{1,4}[\,\.\uff0c\uff0e]?/,
    ], // 中文
  ];

  static async getReferences(
    reader: _ZoteroTypes.ReaderInstance,
    fromCurrentPage = false,
  ): Promise<ItemInfo[]> {
    const refLines = await this.getRefLines(reader, fromCurrentPage);
    if (refLines.length == 0) {
      // new ztoolkit.ProgressWindow("[Fail] PDF", {
      //   closeOtherProgressWindows: true,
      // })
      //   .createLine({
      //     text: "Function getRefLines: 0 refLines",
      //     type: "fail",
      //   })
      //   .show();
      return [];
    }

    const references = this.mergeSameRef(refLines);
    if (references.length > 0) {
      // new ztoolkit.ProgressWindow("[Done] PDF", {
      //   closeOtherProgressWindows: true,
      // })
      //   .createLine({
      //     text: `${references.length} references`,
      //     type: "success",
      //   })
      //   .show();
    } else {
      // new ztoolkit.ProgressWindow("[Fail] PDF", {
      //   closeOtherProgressWindows: true,
      // })
      //   .createLine({
      //     text: "Function mergeSameRef: 0 reference",
      //     type: "fail",
      //   })
      //   .show();
    }
    // ztoolkit.log("references", references);
    for (let i = 0; i < references.length; i++) {
      const ref = { ...references[i] } as PDFLine;
      ref.text = ref.text
        .trim()
        .replace(/^[^0-9a-zA-Z]\s*\d+\s*[^0-9a-zA-Z]/, "")
        .replace(/^\d+[\.\s]?/, "")
        .trim();
      references[i] = {
        text: ref.text,
        ...Utils.refText2Info(ref.text),
        x: ref._x,
        y: ref.y + ref.height,
      } as ItemInfo;
      references[i].url = ref.url || references[i].url;
    }
    return references as ItemInfo[];
  }

  /**
   * Merge patrs with the same height to one part
   * @param items
   * @returns
   */
  static mergeSameLine(items: PDFItem[]) {
    const toLine = (item: PDFItem) => {
      const line: PDFLine = {
        x: parseFloat(item.transform[4].toFixed(1)),
        y: parseFloat(item.transform[5].toFixed(1)),
        text: item.str || "",
        height: item.height,
        width: item.width,
        url: item?.url,
        _height: [item.height],
      };
      if (line.width < 0) {
        line.x += line.width;
        line.width = -line.width;
      }
      return line;
    };

    let j = 0;
    const lines: PDFLine[] = [toLine(items[j])];
    for (j = 1; j < items.length; j++) {
      const line = toLine(items[j]);
      const lastLine = lines.slice(-1)[0];
      // 考虑上标下标
      if (
        line.y == lastLine.y ||
        (line.y >= lastLine.y && line.y < lastLine.y + lastLine.height) ||
        (line.y + line.height > lastLine.y &&
          line.y + line.height <= lastLine.y + lastLine.height)
      ) {
        lastLine.text += " " + line.text;
        lastLine.width += line.width;
        lastLine.url = lastLine.url || line.url;
        // 记录所有高度
        lastLine._height.push(line.height);
      } else {
        // 处理已完成的行，用众数赋值高度
        const hh = lastLine._height;
        // lastLine.height = hh.sort((a, b) => a - b)[parseInt(String(hh.length / 2))]
        // 用最大值
        // lastLine.height = hh.sort((a, b) => b-a)[0]
        // 众数
        const num: any = {};
        for (let i = 0; i < hh.length; i++) {
          num[String(hh[i])] ??= 0;
          num[String(hh[i])] += 1;
        }
        lastLine.height = Number(
          Object.keys(num).sort((h1: string, h2: string) => {
            return num[h2] - num[h1];
          })[0],
        );
        // 新的一行
        lines.push(line);
      }
    }
    return lines;
  }

  /**
   * 如果是参考文献格式的开头，返回类型；否则返回-1
   * @param text
   * @returns
   */
  static getRefType(text: string): number {
    for (let i = 0; i < this.refRegex.length; i++) {
      const flags = new Set(
        this.refRegex[i].map((regex) => {
          return (
            regex.test(text.trim()) || regex.test(text.replace(/\s+/g, ""))
          );
        }),
      );

      if (flags.has(true)) {
        // ztoolkit.log(text, i);
        return i;
      }
    }
    return -1;
  }

  /**
   * @param refLines
   * @returns
   */
  static mergeSameRef(refLines: any[]) {
    const _refLines = [...refLines];
    // ztoolkit.log(this.copy(_refLines));
    const firstLine = refLines[0];
    // 已知新一行参考文献缩进
    const firstX = firstLine.x;
    const secondLine = refLines.slice(1).find((line) => {
      return (
        line.x != firstX && this.abs(line.x - firstX) < 10 * firstLine.height
      );
    });
    // ztoolkit.log(secondLine);
    const indent = secondLine ? firstX - secondLine.x : 0;
    // ztoolkit.log("indent", indent);
    const refType = this.getRefType(firstLine.text);
    // ztoolkit.log(firstLine.text, refType);
    let ref;
    for (let i = 0; i < refLines.length; i++) {
      const line = refLines[i] as PDFLine;
      const text = line.text as string;
      const lineRefType = this.getRefType(text);
      if (
        // this.abs(line.x - firstX) < line.height * 1.2 &&
        // 跳过验证其它，特别小心
        (lineRefType == refType && refType <= 2) ||
        (indent == 0 &&
          lineRefType != -1 &&
          lineRefType == refType &&
          this.abs(firstX - line.x) <
            (this.abs(indent) || line.height) * 0.5) ||
        (indent != 0 &&
          lineRefType == refType &&
          _refLines.find(
            (_line) =>
              line != _line &&
              (line.x - _line.x) * indent > 0 &&
              this.abs(line.x - _line.x) >= this.abs(indent) &&
              this.abs(this.abs(line.x - _line.x) - this.abs(indent)) <
                2 * line.height,
          ) !== undefined)
      ) {
        ref = line;
        // ztoolkit.log("->", line.text);
      } else if (ref) {
        // 是为了去除部分跟随refLines传入的噪声，一般发生在最后几行
        if (
          ref &&
          i / refLines.length > 0.9 &&
          this.abs(this.abs(ref.x - line.x) - this.abs(indent)) >
            5 * line.height
        ) {
          refLines = refLines.slice(0, i);
          // ztoolkit.log(
          //   "x",
          //   line.text,
          //   this.abs(this.abs(ref.x - line.x) - this.abs(indent)),
          //   5 * line.height,
          // );
          break;
        }
        // ztoolkit.log("+", text);
        // Poly-
        // gon
        // -> Polygon
        ref.text =
          ref.text.replace(/-$/, "") +
          (ref.text.endsWith("-") ? "" : " ") +
          text;
        if (line.url) {
          ref.url = line.url;
        }
        refLines[i] = false;
      }
    }
    return refLines.filter((e) => e);
  }

  /**
   * 判断A和B两个矩形是否几何相交
   * @param A
   * @param B
   * @returns
   */
  static isIntersect(A: Box, B: Box): boolean {
    if (
      B.right < A.left ||
      B.left > A.right ||
      B.bottom > A.top ||
      B.top < A.bottom
    ) {
      return false;
    } else {
      return true;
    }
  }

  /**
   * 为items每个item更新对应annotations中annotation的链接信息
   */
  static updateItemsAnnotions(items: PDFItem[], annotations: PDFAnnotation[]) {
    // annotations {rect: [416, 722, 454, 733]}
    // items {transform: [...x, y], width: 82}
    const toBox = (rect: number[]) => {
      const [left, bottom, right, top] = rect;
      return { left, bottom, right, top };
    };
    annotations.forEach((annotation: PDFAnnotation) => {
      const annoBox = toBox(annotation.rect);
      items.forEach((item) => {
        const [x, y] = item.transform.slice(4);
        const itemBox = toBox([x, y, x + item.width, y + item.height]);
        if (this.isIntersect(annoBox, itemBox)) {
          item["url"] = annotation?.url || annotation?.unsafeUrl;
        }
      });
    });
  }

  /**
   * 读取PDF一页面为lines对象
   * @param pdfPage
   * @returns
   */
  static async readPdfPage(pdfPage: any) {
    const textContent = await pdfPage.getTextContent();
    const items: PDFItem[] = textContent.items.filter(
      (item: PDFItem) => item.str.trim().length,
    );
    if (items.length == 0) {
      return [];
    }
    const annotations: PDFAnnotation[] = await pdfPage.getAnnotations();
    // ztoolkit.log("items", this.copy(items));
    // add URL to item with annotation
    this.updateItemsAnnotions(items, annotations);

    // merge items with the same y to lines
    const lines = this.mergeSameLine(items) as PDFLine[];
    return lines;
  }

  static async getRefLines(
    reader: _ZoteroTypes.ReaderInstance,
    fromCurrentPage: boolean,
    fullText: boolean = false,
  ) {
    const PDFViewerApplication = (reader._internalReader._lastView as any)
      ._iframeWindow.PDFViewerApplication;
    await PDFViewerApplication.pdfLoadingTask.promise;
    await PDFViewerApplication.pdfViewer.pagesPromise;
    const pages = PDFViewerApplication.pdfViewer._pages;
    // skip the pdf with page less than 3
    const pageLines: any = {};
    // read 2 page to remove head and tail
    let maxWidth: number, maxHeight: number;
    // offset
    let offset = 0;
    if (fromCurrentPage) {
      offset = pages.length - PDFViewerApplication.page;
    }
    const totalPageNum = pages.length - offset;
    const minPreLoadPageNum = parseInt(
      Zotero.Prefs.get(`${config.addonRef}.preLoadingPageNum`) as string,
    );
    const preLoadPageNum =
      totalPageNum > minPreLoadPageNum ? minPreLoadPageNum : totalPageNum;
    // const popupWin = new ztoolkit.ProgressWindow("[Pending] PDF", {
    //   closeTime: -1,
    //   closeOtherProgressWindows: true,
    // });
    // popupWin
    //   .createLine({
    //     text: `[0/${preLoadPageNum}] Analysis PDF`,
    //     type: "success",
    //     progress: 1,
    //   })
    //   .show();

    for (
      let pageNum = totalPageNum - 1;
      pageNum >= totalPageNum - preLoadPageNum;
      pageNum--
    ) {
      const pdfPage = pages[pageNum].pdfPage;
      maxWidth = pdfPage._pageInfo.view[2];
      maxHeight = pdfPage._pageInfo.view[3];

      const lines = await this.readPdfPage(pdfPage);
      if (lines.length == 0) {
        continue;
      }
      pageLines[pageNum] = lines;
      const pct = ((totalPageNum - pageNum) / preLoadPageNum) * 100;
      // popupWin.changeLine({
      //   text: `[${totalPageNum - pageNum}/${preLoadPageNum}] Read text`,
      //   progress: pct > 90 ? 90 : pct,
      // });
    }
    // analysis maxPct
    // 可能奇数页没有，偶数有
    const parts: any = [];
    let part = [];
    let refPart: any = [];
    const _refPart: any = { done: false, parts: [] };
    const sep = "\n\n===current page===\n\n";
    for (let pageNum = totalPageNum - 1; pageNum >= 1; pageNum--) {
      // ztoolkit.log(sep, pageNum + 1);
      const pdfPage = pages[pageNum].pdfPage;
      maxWidth = pdfPage._pageInfo.view[2];
      maxHeight = pdfPage._pageInfo.view[3];
      // ztoolkit.log(`maxWidth=${maxWidth}, maxHeight=${maxHeight}`);
      let lines: any;
      if (pageNum in pageLines) {
        lines = [...pageLines[pageNum]];
      } else {
        lines = await this.readPdfPage(pdfPage);
        pageLines[pageNum] = [...lines];
        const p = totalPageNum - pageNum;
        // popupWin.changeLine({ text: `[${p}/${p}] Read PDF` });
      }
      if (lines.length == 0) {
        continue;
      }
      // 移除PDF页面首尾关于期刊页码等信息
      // 正向匹配移除PDF顶部无效信息
      const removeNumber = (text: string) => {
        // 英文页码
        if (/^[A-Z]{1,3}$/.test(text)) {
          text = "";
        }
        // 正常页码1,2,3
        text = text.replace(/\s+/g, "").replace(/\d+/g, "");
        return text;
      };
      const isSamePosition = (lineA: PDFLine, lineB: PDFLine) => {
        const round = (n: number) => Math.round(n);
        if (
          round(lineA.x) == round(lineB.x) &&
          round(lineA.y) == round(lineB.y) &&
          round(lineA.width) == round(lineB.width) &&
          round(lineA.height) == round(lineB.height)
        ) {
          return true;
        } else {
          return false;
        }
      };
      // 是否为重复
      const isSameText = (lineA: PDFLine, lineB: PDFLine) => {
        const textA = removeNumber(lineA.text);
        const textB = removeNumber(lineB.text);
        return textA == textB;
      };
      lines.forEach((line: PDFLine) => {
        // 100%正文区域保护
        if (
          (line.x / maxWidth > 0.2 &&
            line.y / maxHeight > 0.2 &&
            (line.x + line.width) / maxWidth < 0.8 &&
            (line.y + line.height) / maxHeight < 0.8) ||
          line.same
        ) {
          return;
        }
        for (const _pageIndex in pageLines) {
          // 排除自身页面
          if (Number(_pageIndex) == pageNum) {
            continue;
          }
          pageLines[_pageIndex].find((_line: PDFLine) => {
            if (isSameText(line, _line) && isSamePosition(line, _line)) {
              // ztoolkit.log(line, _line);
              line.same = _line;
              return true;
            }
          });
        }
      });
      lines = lines.filter((e: any) => !e.same);
      if (lines.length == 0) {
        continue;
      }
      // ztoolkit.log("remove", [...lines.filter((e: any) => e.same)]);
      // 分栏
      // 跳过图表影响正常分栏
      const isFigureOrTable = (text: string) => {
        text = text.replace(/\s+/g, "");
        const flag = /^(Table|Fig|Figure).*\d/i.test(text);
        if (flag) {
          // ztoolkit.log(`isFigureOrTable - skip - ${text}`);
        }
        return flag;
      };
      lines = lines.filter((e: PDFLine) => isFigureOrTable(e.text) == false);
      const columns = [[lines[0]]];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const column = columns.slice(-1)[0];
        if (
          line.y > column.slice(-1)[0].y ||
          column
            .map((_line) => Number(line.x > _line.x + _line.width))
            .reduce((a, b) => a + b) == column.length ||
          column
            .map((_line) => Number(line.x + line.width < _line.x))
            .reduce((a, b) => a + b) == column.length
        ) {
          columns.push([line]);
        } else {
          column.push(line);
        }
      }
      // ztoolkit.log("columns", this.copy(columns));
      columns.forEach((column, columnIndex) => {
        column.forEach((line) => {
          line["column"] = columnIndex;
          line["pageNum"] = pageNum;
        });
      });
      // ztoolkit.log("remove indent", this.copy(lines));

      // part
      let isStart = false;
      const donePart = (part: any[]) => {
        part.reverse();
        // parts.push(part)
        // return
        // 去除缩进同一页同意栏的缩进
        const columns = [[part[0]]];
        for (let i = 1; i < part.length; i++) {
          const line = part[i];
          if (
            line.column == columns.slice(-1)[0].slice(-1)[0].column &&
            line.pageNum == columns.slice(-1)[0].slice(-1)[0].pageNum
          ) {
            columns.slice(-1)[0].push(line);
          } else {
            columns.push([line]);
          }
        }
        columns.forEach((column) => {
          const offset = column.map((line) => line.x).sort((a, b) => a - b)[0];
          column.forEach((line) => {
            line["_x"] = line.x;
            line["_offset"] = offset;
            line.x = parseInt((line.x - offset).toFixed(1));
          });
        });
        parts.push(part);
        return part;
      };
      const isRefBreak = (text: string) => {
        text = text.replace(/\s+/g, "");
        if (fullText) {
          return false;
        } else {
          return (
            /(\u53c2\u8003\u6587\u732e|reference|bibliography)/i.test(text) &&
            text.length < 20
          );
        }
      };
      const doneRefPart = (part: any[]) => {
        part = donePart(part);
        _refPart.parts.push(part);
        // ztoolkit.log("doneRefPart", part[0].text);
        const res = part[0].text.trim().match(/^\d+/);
        if (res && res[0] != "1") {
          _refPart.done = false;
        } else {
          _refPart.done = true;
        }
      };
      // 分析最右下角元素
      const endLines = lines.filter((line: PDFLine) => {
        return lines.every((_line: PDFLine) => {
          if (_line == line) {
            return true;
          }
          // 其它所有行都在它左上方
          return (
            _line.x + _line.width < line.x + line.width || _line.y > line.y
          );
        });
      });
      const heightOverlap = (hh1: number[], hh2: number[]) => {
        return hh1.some((h1) => {
          // 有容差
          return hh2.some((h2) => h1 - h2 < (h1 > h2 ? h2 : h1) * 0.3);
        });
      };
      const endLine = endLines.slice(-1)[0];
      // ztoolkit.log("endLine", endLine);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // 刚开始就是图表，然后才是右下角文字，剔除图表
        if (
          // !isStart && pageNum < totalPageNum - 1 &&
          // 考虑到有些PDF最后一页以图表结尾
          !isStart &&
          // 图表等
          // 我们认为上一页的正文（非图表）应从页面最低端开始
          (line != endLine ||
            // ((line.x + line.width) / maxWidth < 0.7 && line.y > pageYmin) ||
            /(图|fig|Fig|Figure).*\d+/.test(line.text.replace(/\s+/g, "")))
        ) {
          // ztoolkit.log("Not the endLine, skip", line.text);
          // 这里考虑到可能一开始就是图表需要打包扔掉之前的part
          // 10.1016/j.scitotenv.2018.03.202
          if (part.length && pageNum == totalPageNum - 1) {
            donePart(part);
            part = [];
          }
          continue;
        } else {
          isStart = true;
        }
        // 前一页第一行与当前页最后一行
        if (
          part.length > 0 &&
          // part.slice(-1)[0].height != line.height
          !heightOverlap(part.slice(-1)[0]._height, line._height)
          // this.abs(part.slice(-1)[0].height - line.height) > line.height * .5
        ) {
          donePart(part);
          part = [line];
          continue;
        }
        // push之前判断
        if (isRefBreak(line.text)) {
          // ztoolkit.log("isRefBreak", line.text);
          doneRefPart(part);
          part = [];
          break;
        }
        part.push(line);
        if (
          // 以下条件满足则页内断开
          lines[i - 1] &&
          // line.height != lines[i - 1].height ||
          // this.abs(line.height - lines[i - 1].height) > line.height * .5 ||
          (!heightOverlap(line._height, lines[i - 1]._height) ||
            lines[i].column < lines[i - 1].column ||
            (line.pageNum == lines[i - 1].pageNum &&
              line.column == lines[i - 1].column &&
              // 增大行间距阈值
              this.abs(line.y - lines[i - 1].y) > line.height * 3))
          // /^(\[1\]|1\.)/.test(line.text)
        ) {
          if (isRefBreak(lines[i - 1].text)) {
            // ztoolkit.log("isRefBreak", lines[i - 1].text);
            doneRefPart(part);
            part = [];
            break;
          }
          donePart(part);
          part = [];
          // ztoolkit.log(
          //   "break",
          //   line.text,
          //   " - ",
          //   lines[i - 1].text,
          //   this.copy(line),
          //   this.copy(lines[i - 1]),
          // );
        }
      }
      if (_refPart.done) {
        // ztoolkit.log(_refPart);
        _refPart.parts.reverse().forEach((part: any[]) => {
          refPart = [...refPart, ...part];
        });
        break;
      }
    }
    // popupWin.changeLine({ progress: 100 });
    // ztoolkit.log("parts", this.copy(parts));
    // ztoolkit.log(refPart);
    if (refPart.length == 0) {
      const partRefNum = [];
      for (let i = 0; i < parts.length; i++) {
        const isRefs = parts[i].map((line: PDFLine) =>
          Number(this.getRefType(line.text) != -1),
        );
        partRefNum.push([i, isRefs.reduce((a: number, b: number) => a + b)]);
      }
      ztoolkit.log(partRefNum);
      const i = partRefNum.sort((a, b) => b[1] - a[1])[0][0];
      refPart = parts[i];
    }
    // ztoolkit.log("refPart", this.copy(refPart));
    // popupWin.changeHeadline("[Done] PDF");
    // popupWin.changeLine({ progress: 100 });
    // popupWin.startCloseTimer(3000);
    if (fullText) {
      return parts;
    } else {
      return refPart;
    }
  }

  static copy(obj: object) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      ztoolkit.log("Error copy", e, obj);
    }
  }

  static abs(v: number) {
    return v > 0 ? v : -v;
  }
}

export default PDF;
