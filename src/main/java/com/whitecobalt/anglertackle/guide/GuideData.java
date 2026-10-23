package com.whitecobalt.anglertackle.guide;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.profiling.ProfilerFiller;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 教程书内容 —— **全文只有一份来源**：{@code data/anglertackle/guide/guide.json}。
 *
 * <p>数据驱动的原因（docs/10-教程书设计.md）：教程书文案会经常改，
 * 写成 JSON 就能靠数据包热更新，不用重新编译。整合包作者也能覆盖它。
 *
 * <p><b>为什么"内置兜底"是再读一遍那个 json，而不是把正文抄一份进代码</b>：
 * 这里曾经手写过一份五章正文当兜底，与 json 是两份独立文本，靠
 * {@code tools/check-guide-sync.js} 逐章比对来防漂移。可两份文本只要存在就迟早分叉，
 * 而检查脚本只能**事后报警**、拦不住"改了一份"这件事本身 ——
 * 真实发生过：json 改成了八章、代码里还是五章，检查红、游戏里的内容取决于走哪条路。
 * 现在的兜底改成 {@code GuideData.class.getResourceAsStream(内置路径)} 读 mod 自己
 * jar 里的那一份，**解析函数也共用同一个**，于是内置版与数据包版在结构上就是
 * 同一个文件 + 同一段代码，"漂移"从"要靠人记得同步"变成"不可能发生"。
 *
 * <p>注意 {@code getResourceAsStream} 读的是 classpath（发布后是 jar 内，
 * 开发环境是 {@code src/main/resources} 目录），**不经过数据包栈** —— 这正是兜底
 * 该有的语义：整合包那份 json 写坏了、或者数据包压根没加载，兜底仍然拿得到好内容。
 *
 * <p>客户端与服务端都要有一份：服务端负责发内容给客户端，
 * 客户端在单人游戏里也能自己读到（因为内置数据包会被加载进 {@code ResourceManager}）。
 */
public final class GuideData {

    private static final Identifier GUIDE_JSON =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "guide/guide.json");

    /**
     * 内置副本在 classpath 上的绝对路径。
     *
     * <p>必须与数据包里的 {@code data/anglertackle/guide/guide.json} **指同一个文件**
     * （发布后它就是 jar 里的那一条），这样两条路读到的内容不可能不同。
     * 写成常量而不是就地拼接：check-guide-sync.js 会拿它和 resources 下的实际
     * 文件路径比对，改了目录却没改这里会当场红。
     */
    private static final String BUILTIN_GUIDE_PATH = "/data/anglertackle/guide/guide.json";

    /** 单章：标题 + 若干页（每页若干行）。 */
    public record Chapter(String id, String title, List<List<String>> pages) {
    }

    private static List<Chapter> chapters = List.of();
    private static List<String> titles = List.of();

    /**
     * 内置副本的解析结果缓存。
     *
     * <p>为什么必须缓存：{@code chapters} 为空时 {@link #chapters()} 每次都会去读内置副本，
     * 而它会被界面/指令反复调用 —— 每帧重新解析一遍 JSON 是白白烧 CPU，
     * 而且兜底那条路还会**每帧刷一条 WARN**，日志会淹掉真正有用的信息。
     * jar 里的内容在运行期不会变，所以缓存一份即可。
     */
    private static List<Chapter> builtinCache;

    private GuideData() {
    }

    public static List<Chapter> chapters() {
        // 优先用数据包里的内容（整合包作者可以覆盖），没有就用内置副本（jar 里同一份 json）
        if (chapters.isEmpty()) {
            return builtin();
        }
        return chapters;
    }

    public static List<String> titles() {
        List<Chapter> all = chapters();
        return all.stream().map(Chapter::title).toList();
    }

    public static Chapter chapter(int index) {
        List<Chapter> all = chapters();
        if (index < 0 || index >= all.size()) {
            return all.get(0);
        }
        return all.get(index);
    }

    // =================================================================== 内置副本
    /**
     * 最后一道兜底：连内置副本都读不出来时的**唯一一章**。
     *
     * <p>为什么要有它、而且为什么不返回 null：教程缺失只是"少了点内容"，
     * 但这里如果是 null 或异常，会顺着 {@code GuidePayload.of} → 界面/指令
     * 一路炸到玩家身上，表现是"连游戏都进不去"。宁可给一章"数据缺失"，
     * 也不能让一个纯文案问题把游戏拖下水。
     */
    private static final Chapter MISSING_DATA = new Chapter("missing", "教程数据缺失", List.of(List.of(
            "内置的教程数据没能读出来。",
            "多半是安装包不完整，重新装一次模组即可；",
            "钓鱼本身不受影响，可以照常玩。",
            "（数据包版和内置版都失效时才会看到这一页）")));

    /**
     * 内置兜底内容：直接读 jar 里的 {@code /data/anglertackle/guide/guide.json}。
     *
     * <p>三条路按优先级：数据包（{@link ReloadListener}）→ 内置副本（本方法）
     * → {@link #MISSING_DATA}。前两条读的是同一个文件，所以只有"数据包被改坏/没加载"
     * 和"jar 损坏"这两种情况才会降级，且降级**只降内容、不影响游戏运行**。
     *
     * <p>失败一律打 WARN 而不是静默降级：不然以后排查时根本看不出走的是哪条路，
     * 而"内置兜底生效了"和"数据包覆盖生效了"在游戏里长得一模一样。
     */
    private static List<Chapter> builtin() {
        if (builtinCache != null) {
            return builtinCache;
        }
        List<Chapter> loaded = null;
        try (InputStream in = GuideData.class.getResourceAsStream(BUILTIN_GUIDE_PATH)) {
            if (in == null) {
                AnglersTackle.LOGGER.warn(
                        "[垂纶] 内置教程副本 {} 在 classpath 上找不到，教程回退到最小兜底", BUILTIN_GUIDE_PATH);
            } else {
                try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                    loaded = parse(JsonParser.parseReader(reader).getAsJsonObject());
                }
            }
        } catch (Exception e) {
            // 读得到但内容坏了（手工改过 jar、编码不对……）：同样只降级，不往上抛
            AnglersTackle.LOGGER.warn("[垂纶] 内置教程副本解析失败，教程回退到最小兜底: {}", e.toString());
        }
        if (loaded == null || loaded.isEmpty()) {
            if (loaded != null) {
                AnglersTackle.LOGGER.warn("[垂纶] 内置教程副本里一章都没有，教程回退到最小兜底");
            }
            builtinCache = List.of(MISSING_DATA);
        } else {
            builtinCache = List.copyOf(loaded);
        }
        return builtinCache;
    }

    // =================================================================== 解析
    /**
     * 把一个教程 JSON 根对象解析成章节表 —— 内置副本与数据包**共用这一份**。
     *
     * <p>为什么解析规则只能有一份：两份的话会出现"内置版读得出来、数据包版读不出来"
     * 这种只在别人机器上复现的怪事，而且改了一处忘了另一处时，检查脚本也没法判定
     * 哪一份才是对的。
     *
     * <p>字段缺失一律取默认值而不是抛异常（缺 title 就用 id，缺 pages 就是没有页）：
     * 数据包里少写一个标题不该让整本教程变空白 —— 那正是当年"未转义引号导致
     * 整份 JSON 解析失败、教程书全白"的同一类事故。
     */
    private static List<Chapter> parse(JsonObject root) {
        List<Chapter> parsed = new ArrayList<>();
        if (root == null) {
            return parsed;
        }
        JsonArray arr = root.getAsJsonArray("chapters");
        if (arr == null) {
            return parsed;
        }
        for (JsonElement el : arr) {
            JsonObject ch = el.getAsJsonObject();
            String id = ch.has("id") ? ch.get("id").getAsString() : "chapter";
            String title = ch.has("title") ? ch.get("title").getAsString() : id;
            List<List<String>> pages = new ArrayList<>();
            if (ch.has("pages")) {
                for (JsonElement pageEl : ch.getAsJsonArray("pages")) {
                    List<String> lines = new ArrayList<>();
                    for (JsonElement lineEl : pageEl.getAsJsonArray()) {
                        lines.add(lineEl.getAsString());
                    }
                    pages.add(lines);
                }
            }
            parsed.add(new Chapter(id, title, pages));
        }
        return parsed;
    }

    // =================================================================== 重载
    /** 注册到 {@code AddReloadListenerEvent}：数据包里的 guide.json 可覆盖内置副本。 */
    public static final class ReloadListener
            extends SimplePreparableReloadListener<List<Chapter>> {

        @Override
        protected List<Chapter> prepare(ResourceManager manager, ProfilerFiller profiler) {
            List<Chapter> parsed = new ArrayList<>();
            try {
                Map<Identifier, Resource> found = manager.listResources(
                        "guide", rl -> rl.getPath().endsWith("guide.json"));
                for (Map.Entry<Identifier, Resource> entry : found.entrySet()) {
                    try (BufferedReader reader = entry.getValue().openAsReader()) {
                        // 解析共用 GuideData.parse —— 数据包版能读的形式，内置副本必然也能读
                        parsed.addAll(parse(JsonParser.parseReader(reader).getAsJsonObject()));
                    }
                }
            } catch (Exception e) {
                // 数据包内容坏了不影响游戏：丢掉这份，交给内置副本
                AnglersTackle.LOGGER.warn("[垂纶] 数据包里的教程书解析失败，改用内置副本: {}", e.toString());
            }
            return parsed;
        }

        @Override
        protected void apply(List<Chapter> parsed, ResourceManager manager, ProfilerFiller profiler) {
            if (parsed.isEmpty()) {
                // 这里必须是 WARN：整合包作者覆盖了 guide.json 却没生效时，
                // 游戏里照样有教程（走内置副本），只是内容不是他改的那份 ——
                // 静默回退会让这种问题完全看不出来。顺带打出内置副本的章数，便于判断走了哪条路。
                AnglersTackle.LOGGER.warn(
                        "[垂纶] 数据包里的教程书不可用（缺失或解析失败），已回退到内置副本（{} 章）",
                        builtin().size());
                chapters = List.of();
                titles = List.of();
                return;
            }
            chapters = List.copyOf(parsed);
            titles = parsed.stream().map(Chapter::title).toList();
            AnglersTackle.LOGGER.info("[垂纶] 教程书已从数据包加载：{} 章", parsed.size());
        }
    }
}
