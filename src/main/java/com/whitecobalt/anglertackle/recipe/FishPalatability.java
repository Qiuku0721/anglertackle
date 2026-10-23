package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

import java.util.HashMap;
import java.util.Map;

/**
 * 食用适宜度（L0~L5）—— **按调研里的食用描述分级**，不是"红鱼就给高数值"。
 *
 * <p>用户 2026-10-10 两轮定案（原话）：
 * <ol>
 *   <li>"可以补但是**要参考资料**。比如鲯鳅事实上肉质并不好，如果只是因为他是红鱼就给高数值显然不合理"；</li>
 *   <li>"**可以根据描述做分级，越难吃 debuff 越强**。**有些不进菜单**"。</li>
 * </ol>
 * 依据与逐条出处见 {@code docs/料理适配策划案.md}；菜谱侧（哪条鱼能做哪道菜）见 {@code docs/25 §13.5}。
 *
 * <h2>⚠⚠ 兼容性（用户 2026-10-10 明确要求："你是在做老功能，别连代码都不会兼容"）</h2>
 * 这是**既有系统**（做菜早就在跑，老存档里躺着老菜）。所以这张表是**叠加层**：
 * <ul>
 *   <li><b>没有记录的鱼 = L0</b>（{@link #of} 取默认值）—— 老 23 条食用鱼一条都没写进来，
 *       它们的行为**逐字不变**；</li>
 *   <li>它**不动** {@code DishRecipe.AllowedTable.TABLE} 的旧语义（那张表只管"能做哪道菜"），
 *       也**不动**任何存档格式（等级是**规则**，不是存档数据）；</li>
 *   <li>L5 那五条本来就不在菜品菜单里 —— 所以"不进菜单"是**零删除**，一个旧配方都没被拿掉。</li>
 * </ul>
 *
 * <h2>等级</h2>
 * <pre>
 *   L0 佳     正常菜品，无负面            （大西洋鳕 / 狼鱼 / 裸盖鱼 / 哲罗鲑 …）
 *   L1 普通   正常菜品，无机制           （江鳕偏干 / 北极鳕做鱼粉 / 大西洋鲱须腌制 …）
 *   L2 需处理 **生食**才有概率反胃；煮熟就正常（虹鳟 / 北极红点鲑 / 高白鲑 / 鲯鳅）
 *   L3 难吃   生熟都必反胃               （鳄雀鳝：筋腱极多，须反复刮）
 *   L4 危险   生熟都带凋零               （格陵兰鲨须发酵 / 电鳗须耗电 / 雨伞旗鱼汞富集）
 *   L5 非食物 **不进菜品菜单**           （孔雀鱼 / 非洲蝴蝶鱼 / 红宝石鱼 / 长吻象鼻鱼 / 盲鱼）
 * </pre>
 *
 * <p>⚠ <b>盲鱼（金线鲃）为什么是 L5</b>：现实里它是名贵食用鱼（徐霞客记"滇池珍味"），
 * 但它是**国家二级保护动物** —— 所以游戏里归"受保护，不食用"，与"不好吃"是两回事。
 * 它从第一批起就是观赏鱼（docs/25 §13.5.3），**不许**被"补全料理"顺手改成能吃的。
 */
public final class FishPalatability {

    /** 等级常量（0 起算，与品质档位同一套习惯，见 AGENTS.md 第二条）。 */
    public static final int L0 = 0;
    public static final int L1 = 1;
    public static final int L2 = 2;
    public static final int L3 = 3;
    public static final int L4 = 4;
    public static final int L5 = 5;

    /** 生食概率反胃的概率（L2）。用户口径是"**概率**"，不是每次必中。 */
    private static final float RAW_NAUSEA_CHANCE = 0.35F;

    private static final int NAUSEA_TICKS = 600;   // 30 秒
    private static final int WITHER_TICKS = 200;   // 10 秒

    private FishPalatability() {}

    /**
     * ⚠ 与 {@code DishRecipe.AllowedTable} 同样是"内部持有类 + 首次访问才建表"——
     * 类级静态字段 + 静态块会在 1.1.7 那种初始化顺序下与枚举互锁（详见 DishRecipe 的注释）。
     * 这里虽然没有枚举，但保持同一写法，免得下一个人以为可以随便改成类级字段。
     */
    private static final class Table {
        static final Map<String, Integer> LEVEL = build();
    }

    private static Map<String, Integer> build() {
        Map<String, Integer> m = new HashMap<>();
        // ── L1 普通：能吃，只是不精致（依据见 docs/料理适配策划案.md §3）────────────
        put(m, L1, "burbot",            // 江鳕：FishBase "Flesh is tasty but a little dry"
                   "arctic_cod",        // 北极鳕："Utilized as fishmeal and source of oil"
                   "capelin",           // 毛鳞鱼：雌鱼鱼卵受重视，雄鱼做鱼粉
                   "atlantic_herring",  // 大西洋鲱：繁殖期脂肪 20%，须腌制/发酵
                   "redfish");          // 平鲉：北大西洋重要商业鱼（FishBase 的雪卡标注地理不合理，不作依据）
        // ── L2 需处理：**生食**有寄生虫风险，煮熟就正常 ────────────────────────────
        put(m, L2, "rainbow_trout",     // 虹鳟：淡水寄生虫（港府：-20℃ 7 天）
                   "arctic_char",       // 北极红点鲑：FishBase "Parasitized by tapeworm"
                   "whitefish",         // 高白鲑：冷水鱼皇后，当地有刺身吃法（外推）
                   "mahi_mahi");        // 鲯鳅：肉质一般 + 雪卡风险 —— 用户点名的例子
        // ── L3 难吃：生熟都难吃（须反复刮筋）─────────────────────────────────────
        put(m, L3, "alligator_gar");    // 鳄雀鳝：筋腱极多、肉无味（卵与内脏另有剧毒，已记在图鉴文本里）
        // ── L4 危险：鲜食有毒，处理得当才降级 ────────────────────────────────────
        // ⚠⚠ 2026-10-11 **修正**（用户原话："配方要经得起考究"）——
        //   这里原来还写了 electric_eel 与 sailfish，两条都**站不住**，已撤：
        //   · 电鳗：科普中国原文"是原产地**著名的食用鱼**"、"当地有名的伤人动物和**餐桌美味**" ——
        //     它的危险是**电击** ✗，不是毒性 ✗。把"抓它危险"当成"吃它危险"是**分类错误**
        //     （而且它那条真实做法——"放电耗尽后再动手"——属于**处理**，不属于"吃了会怎样"）。
        //   · 雨伞旗鱼：汞是**慢性蓄积** ✗，不是吃一口就凋零 ✗ —— 它已经由 chronicRisk()
        //     归进 "mercury"（累积型），那才是与事实相符的表达。
        //   详见 docs/料理适配策划案.md 的《修正记录》一节（写明了来源、原判断、为什么错，
        //   免得下一个人照着旧文档又改回去 ✗）。
        put(m, L4, "greenland_shark");  // 格陵兰鲨：鲜肉含尿素 + TMAO，FishBase "Poisonous to eat"
        // ── L5 非食物：不进菜品菜单（本来就不在 DishRecipe 的表里 ⇒ 零删除）─────────
        put(m, L5, "african_butterflyfish", "jewel_cichlid", "guppy", "elephantnose",
                   "cave_blindfish");   // 盲鱼：现实里名贵，但它是国家二级保护动物
        return Map.copyOf(m);
    }

    private static void put(Map<String, Integer> m, int level, String... species) {
        for (String s : species) {
            Integer old = m.put(s, level);
            if (old != null) {
                throw new IllegalStateException("食用适宜度表里 " + s + " 写了两次（" + old + " / " + level + "）");
            }
        }
    }

    /** 这条鱼的等级。**没有记录 = L0**（老鱼种全部走这里 ⇒ 行为不变）。 */
    public static int of(String speciesId) {
        if (speciesId == null || speciesId.isEmpty()) return L0;
        return Table.LEVEL.getOrDefault(speciesId, L0);
    }

    /** 进不进菜品菜单（L5 不进）。 */
    public static boolean inDishMenu(String speciesId) {
        return of(speciesId) < L5;
    }

    /** 吃这一口会得到什么负面。 */
    public enum Bite {
        /** 无事（L0 / L1，以及 L2 煮熟之后）。 */
        NONE,
        /** 生食才**有概率**反胃（L2）。 */
        NAUSEA_CHANCE,
        /** 必反胃（L3）。 */
        NAUSEA,
        /** 凋零（L4）。 */
        WITHER
    }

    /**
     * @param raw 这一口是不是**生**的（刺身 / 生鱼块）。L2 只有生食才出事，煮熟就正常。
     */
    public static Bite biteOf(String speciesId, boolean raw) {
        switch (of(speciesId)) {
            case L2: return raw ? Bite.NAUSEA_CHANCE : Bite.NONE;
            case L3: return Bite.NAUSEA;
            case L4: return Bite.WITHER;
            default: return Bite.NONE;   // L0 / L1 / L5
        }
    }

    /**
     * 把这一口的负面发给玩家。**只对非零等级生效** —— L0/L1 走的是改动前那条老路（什么都不发）。
     *
     * <p>⚠ 整段包在 try/catch 里：吃一口菜绝不能因为这张表出问题而抛异常
     * （和 {@code LeaderboardHooks.onLanded} 同一条纪律）。
     */
    public static void apply(Player player, ItemStack stack, boolean raw) {
        if (player == null || stack == null) return;
        try {
            FishChunkData data = stack.get(ModDataComponents.FISH_CHUNK.get());
            if (data == null) return;               // 创造模式直接拿的菜没有鱼种 ⇒ 不判
            String species = data.speciesId();

            // ★ 慢性风险**先记，然后才判即时负面** —— 这个顺序不能反：
            //   裸盖鱼（"银鳕鱼"）是 L0（吃一口什么都不会发生），可它正是汞富集的那条鱼。
            //   要是把它放在下面 bite 的早退之后，它就**永远不计数** —— 而那恰恰是"慢性"最该生效的鱼。
            applyChronic(player, species);

            Bite bite = biteOf(species, raw);
            if (bite == Bite.NONE) return;
            if (bite == Bite.NAUSEA_CHANCE
                    && player.getRandom().nextFloat() >= RAW_NAUSEA_CHANCE) {
                return;
            }
            switch (bite) {
                case NAUSEA_CHANCE:
                case NAUSEA:
                    player.addEffect(new MobEffectInstance(MobEffects.CONFUSION, NAUSEA_TICKS, 0));
                    break;
                case WITHER:
                    player.addEffect(new MobEffectInstance(MobEffects.WITHER, WITHER_TICKS, 0));
                    break;
                default:
                    break;
            }
        } catch (Throwable ignored) {
            // 故意吞掉：这条是味道惩罚，不该影响"吃东西"本身
        }
    }

    /**
     * 这一口会不会有负面 —— 给**悬浮文本 / 菜谱界面**用的文案键（用户 2026-10-11：
     * "加 debuff 提示在悬浮文本和菜谱"）。
     *
     * <p>⚠⚠ 界面**不许自己抄一张"哪条鱼有什么负面"的表**。这是 {@code docs/29} 记过的纪律
     * （{@code check-cookbook.js} 的 {@code cookbook-hover-own-numbers} 就是守它的：
     * 悬浮显示自己算效果 = 与真正发的效果分叉）。所以这里和 {@link #apply} 共用**同一个**
     * {@link #biteOf} —— 改一处，界面与机制同时跟着变，"写着没事、吃了反胃"这种谎话说不出来。
     *
     * @return 语言键；**这一口没有任何负面时返回 {@code null}**（界面此时什么都不加，
     *         于是 L0/L1 的菜悬浮文本与改动前**逐字一致**）
     */
    public static String warningKey(String speciesId, boolean raw) {
        switch (biteOf(speciesId, raw)) {
            case NAUSEA_CHANCE: return "tooltip.anglertackle.palat.raw_parasite";
            case NAUSEA:        return "tooltip.anglertackle.palat.nausea";
            case WITHER:        return "tooltip.anglertackle.palat.wither";
            default:            return null;
        }
    }

    /** L5（非食物）在菜谱界面里那句话的键。 */
    public static final String INEDIBLE_KEY = "tooltip.anglertackle.palat.inedible";

    /** 慢性风险触发时负面持续多久（60 秒）——"慢性"的意思是**攒够次数才来一次**，不是来得轻。 */
    private static final int CHRONIC_TICKS = 1200;
    /** 二噁英那一条走中毒（10 秒，与反胃不同：中毒是掉血的）。 */
    private static final int CHRONIC_POISON_TICKS = 200;

    /**
     * 这条鱼有没有**慢性**风险（汞 / 雪卡 / 二噁英）—— 用户 2026-10-11 定案 C①："累积型：
     * 吃够 N 次触发一次，**不每次必中**"。次数与触发在 {@link PalatabilityLedger}。
     *
     * <p>依据（docs/料理适配策划案.md §3，全部来自调研）：
     * <ul>
     *   <li>{@code mercury}：裸盖鱼（"银鳕鱼"有婴幼儿血汞异常报道）、雨伞旗鱼（多篇论文记汞生物富集）</li>
     *   <li>{@code ciguatera}：鲯鳅（雪卡）</li>
     *   <li>{@code dioxin}：大西洋鲱（鲱鱼罐头的二噁英提示）</li>
     * </ul>
     *
     * <p>⚠ 这张表是"**风险种类**"的唯一真源（等级表管的是"难不难吃"，管不了"是哪一种毒"）。
     * 悬浮文本与菜谱都来这里取，不许另抄。
     *
     * @return 风险种类；没有慢性风险返回 {@code null}
     */
    public static String chronicRisk(String speciesId) {
        switch (speciesId == null ? "" : speciesId) {
            case "sablefish":
            case "sailfish":
                return "mercury";
            case "mahi_mahi":
                return "ciguatera";
            case "atlantic_herring":
                return "dioxin";
            default:
                return null;
        }
    }

    /** 慢性风险的提示键（给悬浮文本/菜谱用；没有风险返回 {@code null}）。 */
    public static String chronicKey(String speciesId) {
        String risk = chronicRisk(speciesId);
        return risk == null ? null : "tooltip.anglertackle.palat.chronic." + risk;
    }

    /**
     * 慢性风险的累积与触发。**只有服务端玩家才有账本**（客户端没有存档 ✗）。
     *
     * <p>包在调用方的 try/catch 里 ✓；这里再挡住"没有账本可写"的情况 ✓（单人客户端、离线等）。
     */
    private static void applyChronic(Player player, String species) {
        String risk = chronicRisk(species);
        if (risk == null) {
            return;
        }
        if (!(player instanceof net.minecraft.server.level.ServerPlayer serverPlayer)) {
            return;
        }
        if (!PalatabilityLedger.get(serverPlayer.level()).bump(serverPlayer.getUUID(), risk)) {
            return;   // 还没吃够 —— 大多数时候走这条，"不每次必中"
        }
        switch (risk) {
            case "mercury":
                player.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, CHRONIC_TICKS, 0));
                break;
            case "ciguatera":
                player.addEffect(new MobEffectInstance(MobEffects.CONFUSION, CHRONIC_TICKS, 0));
                break;
            case "dioxin":
                player.addEffect(new MobEffectInstance(MobEffects.POISON, CHRONIC_POISON_TICKS, 0));
                break;
            default:
                break;
        }
    }

    /**
     * L5（非食物）的全部鱼种，**按等级表的插入顺序**（= 表里的书写顺序，稳定可复现）。
     *
     * <p>为什么要有这个方法：这五条鱼**永远不出现在菜品菜单里**（{@code AllowedTable} 里没有它们），
     * 于是菜谱界面里一条都看不到 —— 玩家只会觉得"这几条鱼怎么什么菜都做不了"，
     * 看不到原因（其实不是难吃，是**没有食用记录 / 受保护**）。
     * 所以菜谱要写一行说明，而说明里的名单**必须从这张表来**，不许在界面里再抄一份
     * （抄一份 = 以后动等级表时界面开始撒谎，docs/29 那条纪律）。
     */
    public static java.util.List<String> inedibleSpecies() {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (java.util.Map.Entry<String, Integer> e : Table.LEVEL.entrySet()) {
            if (e.getValue() == L5) out.add(e.getKey());
        }
        java.util.Collections.sort(out);   // 表是 HashMap，排序后才能稳定显示
        return java.util.List.copyOf(out);
    }
}
