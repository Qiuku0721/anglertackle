package com.whitecobalt.anglertackle.client.screen;

import net.minecraft.client.Minecraft;

/**
 * 界面自适应：把"设计尺寸"折成"这次窗口真正装得下的尺寸"。
 *
 * <h2>为什么需要它</h2>
 * 用户 2026-10-02 截图："很明显，图鉴的内容屏幕装不下了。"
 * 四个界面（图鉴 / 指南 / 商店 / 改装）原来都把面板尺寸写成常量，
 * 而 MC 的窗口尺寸是 **GUI 缩放折算后的逻辑像素**：
 * 同一个 1920×1080 屏，缩放 2 是 960×540、缩放 4 只剩 480×270。
 * 于是窗口一小（或缩放一大），面板就顶出屏幕：左边一列被切、
 * 最下面一行落到屏幕外 —— 界面不报错，玩家只看到"内容缺了一块"。
 *
 * <h2>用法</h2>
 * <pre>
 *   // 1) 设计尺寸仍写成常量（布局按它来数；窗口够大时用的就是它）
 *   private static final int PANEL_W = 470, PANEL_H = 224;
 *   // 2) init() 里折成实际尺寸
 *   panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
 *   panelH = UiLayout.panelH(this.height, PANEL_H, MIN_H);
 *   rowsPerPage = UiLayout.rows(panelH, LIST_Y, 24, ROW_H);
 *   // 3) 横向位置用 fitX 映射；文字用 fitText 截断
 *   int x = left + UiLayout.fitX(COL_KG, PANEL_W, panelW, COL_NAME);
 * </pre>
 *
 * <p>⚠ 别在绘制/重建里直接用 {@code PANEL_W}/{@code PANEL_H} ——
 * 那两个只是"窗口够大时的设计尺寸"。守着这条的是 {@code tools/check-ui-fit.js}。
 */
public final class UiLayout {

    /** 面板四周至少留出的边距（阴影 6px + 呼吸感）。 */
    public static final int MARGIN = 16;

    private UiLayout() {
    }

    /**
     * 面板宽度。
     *
     * @param minW 宽度下限：窗口比它还小（GUI 缩放 4 + 小窗口）时面板会略微出屏，
     *             那种尺寸下本来就没法看了，保可读性优先
     */
    public static int panelW(int windowW, int designW, int minW) {
        return Math.max(minW, Math.min(designW, windowW - MARGIN));
    }

    /** 面板高度。语义同 {@link #panelW}。 */
    public static int panelH(int windowH, int designH, int minH) {
        return Math.max(minH, Math.min(designH, windowH - MARGIN));
    }

    /**
     * 面板内的横向映射：设计坐标 {@code x} → 实际坐标。
     *
     * <p>左右各留 {@code inset} 像素，中间等比压缩。面板等于设计宽度时
     * **原样返回**——所以默认尺寸下版式与改动前逐像素一致。
     */
    public static int fitX(int x, int designW, int panelW, int inset) {
        int span = designW - 2 * inset;
        int avail = Math.max(1, panelW - 2 * inset);
        return inset + (int) Math.round((x - inset) * (double) avail / span);
    }

    /**
     * 每页行数：按"面板高 − 页脚 − 顶部"算出来，至少 1 行。
     *
     * <p>⚠ 不能写死行数：窗口一矮就会变成"最后几行落在屏幕外"（用户报的就是这个）。
     */
    public static int rows(int panelH, int top, int footer, int rowH) {
        return Math.max(1, (panelH - footer - top) / rowH);
    }

    /**
     * 超宽就截断并补省略号。
     *
     * <p>⚠ 必须自己截：{@link TextWidget} 里是 {@code drawString}，**不会裁剪** ——
     * 面板一窄，长文本会直接压到边框外面去。截断用字体自己的宽度表，
     * 中英混排都算得准。
     */
    public static String fitText(String text, int maxWidth) {
        if (text == null) {
            return null;
        }
        var font = Minecraft.getInstance().font;
        if (font.width(text) <= maxWidth) {
            return text;
        }
        String dots = "...";
        int room = Math.max(0, maxWidth - font.width(dots));
        return font.plainSubstrByWidth(text, room) + dots;
    }

    /**
     * **中文友好折行**：按宽度折，但**不在"数字/拉丁词"与紧跟其后的中文之间断开**。
     *
     * <h2>为什么不能用 {@code font.split}</h2>
     * 用户 2026-10-12 实测（邮件正文）："本期在 5 / 游戏日后统一结算… ——
     * 让人读起来戛然而止"。原版 {@code font.split} 是**逐字符**填的，一行填满就断，
     * 于是"5 游戏日"、"30 游戏分钟"、"Lv.21 评定"这类**跨文字系统的词组**会被从中间劈开 ✗。
     *
     * <h2>规则（只有一条）</h2>
     * 折行点只允许落在词边界（中日韩字之间、空格处）；若正好要在一个拉丁/数字词
     * 与紧随其后的中文之间断开，就把那个拉丁词**一起挪到下一行** ✓。
     *
     * <p>⚠ 这里**不追求**完整排版规则（避头尾、标点挤压都没有）—— 只解决"数字与单位
     * 被拆开"这一条实测到的问题。正文本身也应当按短句手写：
     * `check-mail.js` 会断言每条 `mail.anglertackle.*.body` 的行**都不超过 24 字**。
     */
    public static java.util.List<String> wrapCjk(String text, int maxWidth) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (text == null || text.isEmpty()) {
            return out;
        }
        var font = Minecraft.getInstance().font;
        for (String para : text.split("\n", -1)) {
            if (para.isEmpty()) {
                out.add("");
                continue;
            }
            // 切成"原子"：拉丁/数字词（连它后面的空格）算一个原子，其余（中文、标点）按单字算
            java.util.List<String> atoms = new java.util.ArrayList<>();
            int i = 0;
            while (i < para.length()) {
                char c = para.charAt(i);
                if (isLatin(c)) {
                    int j = i;
                    while (j < para.length() && (isLatin(para.charAt(j)) || para.charAt(j) == ' ')) {
                        j++;
                    }
                    atoms.add(para.substring(i, j));      // 例如 "5 "、"Lv.21 "
                    i = j;
                } else {
                    atoms.add(String.valueOf(c));
                    i++;
                }
            }
            StringBuilder line = new StringBuilder();
            int lineW = 0;
            for (int k = 0; k < atoms.size(); k++) {
                String a = atoms.get(k);
                int w = font.width(a);
                if (lineW + w > maxWidth && line.length() > 0) {
                    // 要断了：若这个原子是**中文**、而上一个原子是拉丁/数字词，
                    // 就把上一个原子也挪到下一行（"5 游戏日"不许拆成两行）
                    String moved = "";
                    if (!isLatin(a.charAt(0)) && k > 0 && isLatin(atoms.get(k - 1).charAt(0))
                            && line.length() > atoms.get(k - 1).length()) {
                        moved = atoms.get(k - 1);
                        line.setLength(line.length() - moved.length());
                        lineW -= font.width(moved);
                    }
                    out.add(rstrip(line.toString()));
                    line = new StringBuilder(moved);
                    lineW = font.width(moved);
                }
                line.append(a);
                lineW += w;
            }
            out.add(rstrip(line.toString()));
        }
        return out;
    }

    /** 拉丁字母 / 数字 / 常见符号 —— 折行时与中文分开处理的那一类。 */
    private static boolean isLatin(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '.' || c == '/' || c == ':' || c == '%' || c == '+' || c == '-';
    }

    private static String rstrip(String s) {
        int e = s.length();
        while (e > 0 && s.charAt(e - 1) == ' ') {
            e--;
        }
        return s.substring(0, e);
    }
}
