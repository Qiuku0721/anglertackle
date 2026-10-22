package com.whitecobalt.anglertackle.fishing;

import java.util.HashMap;
import java.util.Map;

import static com.whitecobalt.anglertackle.fishing.WaterBody.*;

/**
 * 鱼种 → 水体归属表。
 *
 * <h2>为什么单独一张表，而不是塞进 FishSpecies 的构造参数</h2>
 * 归属是**一条一条查出来的生态事实**（用户要求"自己判断查习性"），
 * 摆成一张表才能整体审阅：哪几种鱼挤在同一个水域、哪个水域是不是空的、
 * 某个水体的路亚鱼是不是全被砍了 —— 这些一眼就能看出来。
 * 拆成 21 处构造参数就只能逐个点开看，加鱼时也更容易漏。
 *
 * <p>代价是与 {@code FishSpecies.ALL} 之间存在"两处都要改"的风险，
 * 所以有检查脚本盯着：表里的 id 必须和 ALL 完全一致，多一个少一个都报错。
 *
 * <h2>归属依据（真实习性）</h2>
 * <table>
 *   <tr><td>鲫鱼</td><td>广布性淡水底栖，河湖塘沼都能活，耐污耐低氧</td><td>河/湖/沼</td></tr>
 *   <tr><td>罗非鱼</td><td>热带淡水，喜静水缓流，怕冷</td><td>湖/沼</td></tr>
 *   <tr><td>鲻鱼</td><td>广盐性，河口—近海—也能溯河</td><td>海/河</td></tr>
 *   <tr><td>草鱼</td><td>江河湖泊中下层草食（四大家鱼）</td><td>河/湖</td></tr>
 *   <tr><td>青鱼</td><td>大水面底层，吃螺蚬，体型大</td><td>河/湖</td></tr>
 *   <tr><td>横纹南鳅</td><td>条鳅科，溪流急流石缝，清洁冷水</td><td>河/洞</td></tr>
 *   <tr><td>白条（䱗）</td><td>河流中上层小型，喜流水</td><td>河</td></tr>
 *   <tr><td>翘嘴鲌</td><td>江河湖泊中上层掠食</td><td>河/湖</td></tr>
 *   <tr><td>梭鲈</td><td>江河湖泊掠食，耐浊耐暗，能进深水</td><td>河/湖/洞</td></tr>
 *   <tr><td>蓝宝石雷龙（鳢）</td><td>东南亚静水/黑水/沼泽，耐低氧，喜躲藏阴暗</td><td>沼/洞</td></tr>
 *   <tr><td>铂金银龙</td><td>南美泛滥平原与静水沼泽</td><td>沼/河</td></tr>
 *   <tr><td>大眼海鲢</td><td>海洋沿岸洄游，也进河口</td><td>海/深海</td></tr>
 *   <tr><td>大西洋鲑</td><td>溯河洄游：海洋长大，回河产卵</td><td>河/海</td></tr>
 *   <tr><td>蓝鳍金枪鱼</td><td>远洋开阔大洋</td><td>仅深海</td></tr>
 *   <tr><td>幼鲨</td><td>近海到远海</td><td>海/深海</td></tr>
 *   <tr><td>虎鱼</td><td>非洲河流急流掠食</td><td>河</td></tr>
 *   <tr><td>狗鱼</td><td>北半球静水缓流伏击，湖泊沼泽，也进阴暗死水</td><td>湖/沼/洞</td></tr>
 *   <tr><td>褐鳟</td><td>冷水溪流，需高溶氧</td><td>河</td></tr>
 *   <tr><td>镜鲤</td><td>鲤鱼变种，静水湖泊池塘底层</td><td>湖</td></tr>
 *   <tr><td>条纹鲈</td><td>海洋沿岸与河口洄游</td><td>海/深海</td></tr>
 *   <tr><td>巨骨舌鱼</td><td>亚马逊河流泛滥平原，需低氧环境</td><td>河</td></tr>
 *   <tr><td>非洲蝴蝶鱼</td><td>西非/中非静水与缓流，<b>严格的水面层</b>，水草茂密处；黄昏活跃；专性空气呼吸</td><td>河/沼</td></tr>
 *   <tr><td>红宝石鱼</td><td>西非泥底与沙底的河道/运河，底栖~中层，与森林遮蔽相关</td><td>河/湖</td></tr>
 *   <tr><td>孔雀鱼</td><td>南美北部温泉出水口、水草茂密的沟渠与湖泊，上层小型鱼</td><td>湖/沼</td></tr>
 *   <tr><td>长吻象鼻鱼</td><td>尼日尔—刚果河流域，<b>幽暗泥泞的河床</b>、水流缓慢；夜行、弱电觅食</td><td>河/洞</td></tr>
 *   <tr><td>北非胡子鲇</td><td>泛非淡水广布，偏好浅而沼泽化、软泥底、水流平静处；耐低氧、能离水</td><td>河/湖/沼</td></tr>
 * </table>
 *
 * <p><b>每一项水域 × 每一种竿型都必须非空</b>（有检查脚本断言）——
 * 否则会出现"某个水域什么都钓不到"，而那种 bug 玩家只会当成"这里没鱼"。
 */
public final class FishWaters {

    private FishWaters() {
    }

    private static final Map<String, Integer> TABLE = new HashMap<>();

    /** 鱼种 → 它**要求**的水域修饰（极地 / 高寒湖 / 冷水溪流）。见 {@link #putMods}。 */
    private static final Map<String, Integer> MODS = new HashMap<>();

    private static void put(String id, int mask) {
        TABLE.put(id, mask);
    }

    /**
     * 登记"**只有命中该修饰才出现**"的鱼种。
     *
     * <p>用户 2026-10-08 定的语气是"不止做极地鱼"——修饰是**叠加**的，不是新的水体值：
     * 普通鱼种照旧出现在这些水域里（高山湖里当然也有普通湖鱼），
     * 而这里登记的鱼种只在命中了对应修饰的水里出现。
     *
     * <p>落成两句话（与 docs/33 §9.1 的公式逐字对应）：
     * <pre>出鱼判定 = 本体.matches(掩码) || 修饰命中且掩码含该修饰位</pre>
     * 所以登记了修饰的鱼种，{@code TABLE} 里给 0 即可（0 = 本体哪都不算，
     * 它的"家"由修饰决定）；反过来，一条鱼若想在**普通**河流也出现，
     * 就**不要**登记修饰 —— 本体已经覆盖它了。
     */
    private static void putMods(String id, int modMask) {
        MODS.put(id, modMask);
    }

    static {
        // ---- 淡水广布 ----
        put("crucian_carp", M_RIVER | M_LAKE | M_SWAMP);
        put("tilapia", M_LAKE | M_SWAMP);
        put("grass_carp", M_RIVER | M_LAKE);
        put("black_carp", M_RIVER | M_LAKE);

        // ---- 第三批 5 种（用户 2026-10-01 指定）----
        // 依据逐条写在 fish_research/<id>.json 的 waterLayer 字段里，附来源 URL。
        put("african_butterflyfish", M_RIVER | M_SWAMP);   // 水面层：静水/缓流的沼泽与河湾
        put("jewel_cichlid", M_RIVER | M_LAKE);            // 泥底/沙底的河道与湖泊
        put("guppy", M_LAKE | M_SWAMP);                    // 水草茂密的静水浅水
        put("elephantnose", M_RIVER | M_CAVE);             // 幽暗泥泞的河床（洞穴=无光的静水）
        put("north_african_catfish", M_RIVER | M_LAKE | M_SWAMP); // 广布，偏爱沼泽化软泥底

        // ---- 溪流 / 河流 ----
        put("banded_loach", M_RIVER | M_CAVE);
        put("hemiculter", M_RIVER);
        put("brown_trout", M_RIVER);
        put("tigerfish", M_RIVER);
        put("arapaima", M_RIVER);

        // ---- 河湖掠食 ----
        put("topmouth_culter", M_RIVER | M_LAKE);
        put("zander", M_RIVER | M_LAKE | M_CAVE);

        // ---- 沼泽 / 静水 ----
        put("sapphire_snakehead", M_SWAMP | M_CAVE);
        put("platinum_arowana", M_SWAMP | M_RIVER);
        put("pike", M_LAKE | M_SWAMP | M_CAVE);
        put("mirror_carp", M_LAKE);

        // ---- 海洋 ----
        put("mullet", M_OCEAN | M_RIVER);          // 广盐性，河口—近海—溯河
        put("oxeye_tarpon", M_OCEAN | M_DEEP);
        put("striped_bass", M_OCEAN | M_DEEP);
        put("juvenile_shark", M_OCEAN | M_DEEP);
        put("atlantic_salmon", M_RIVER | M_OCEAN); // 溯河洄游
        put("bluefin_tuna", M_DEEP);               // 只在大洋

        // ---- 第四批 2 种（用户 2026-10-02 定案）：洞穴专属台钓鱼 ----
        //
        // 为什么要补这两种：洞穴水域原本只有横纹鱼[0,1]、长吻象鼻鱼[3,4]、
        // 蓝宝石雷龙鱼[5] —— **中间蓝紫档是空的**，玩家带秘制窝（下限抬到 2）时
        // 横纹鱼被挡住，池子只剩两种且都是金红鱼种 → "饵料控制金红占比 3%~10%"
        // 那条规则无从生效 → 体感"几竿三条雷龙"。
        // 依用户口径：两种都是**洞穴鱼**（只登记 CAVE，不出现在河湖）。
        put("golden_loach", M_CAVE);       // 金泥鳅：洞穴淤泥底层
        put("cave_blindfish", M_CAVE);     // 盲鱼：洞穴暗河的无眼小鱼

        // ================================================================ 水域修饰（第 1 批，用户 2026-10-08）
        //
        // ⚠ 这五条在本体表里登记的是 **0**：0 = "本体哪都不算"，它们的"家"完全由修饰决定。
        //   写成 M_RIVER 之类会让它们在**所有**河里出现，那就不是"冷水溪流专属鱼"了。
        //   0 也不是"漏登记"—— 本体表里**出现**过 id 这件事本身就是一条断言的数据来源
        //   （check-water-body 第 ② 节：表必须覆盖全部鱼种）。
        put("arctic_char", 0);
        put("whitefish", 0);
        put("rainbow_trout", 0);
        put("burbot", 0);
        put("taimen", 0);

        // 语义（docs/33 §9.1）：出鱼 = 本体匹配 **或**（修饰命中 且 鱼种声明了该修饰位）。
        // ⚠ 一条鱼若想在**普通**河流里也出现（比如大西洋鲑），就**不要**登记修饰 ——
        //   本体掩码已经覆盖它了；登记修饰等于把它从普通河里拿掉。
        putMods("arctic_char", M_ALPINE_LAKE);   // 北极红点鲑：高寒湖（耐力型招牌）
        putMods("whitefish", M_ALPINE_LAKE);     // 高白鲑：高寒湖（中层小鱼）
        putMods("rainbow_trout", M_COLD_STREAM); // 虹鳟：冷水溪流（需高溶氧的活水）
        putMods("burbot", M_COLD_STREAM);        // 江鳕：冷水溪流（唯一淡水鳕科，底栖）
        putMods("taimen", M_COLD_STREAM);        // 哲罗鲑：冷水溪流（世界最大鲑科）

        // ================================================================ 极地（第 3 批，用户 2026-10-08）
        //
        // ⚠ 这一批**全部只认 M_POLAR**（本体掩码同样是 0）：极地水是"群系常年覆冰且非高山"
        //   这个**修饰**，与水体本体无关 —— 冻河、冻洋、雪原湖都算，所以不能写 M_RIVER/M_OCEAN ✗。
        // ⚠ 它也是**所有水体上的修饰**：一条极地河里老鱼的占比会被这 9 条稀释，
        //   所以这批刻意以高档次（紫/金/红）为主 —— 低档常见鱼只有 2 条（北极鳕、毛鳞鱼）。
        put("arctic_cod", 0);
        put("capelin", 0);
        put("atlantic_herring", 0);
        put("wolffish", 0);
        put("redfish", 0);
        put("sablefish", 0);
        put("atlantic_cod", 0);
        put("greenland_halibut", 0);
        put("greenland_shark", 0);

        putMods("arctic_cod", M_POLAR);          // 北极鳕：冰下成群的小杂鱼
        putMods("capelin", M_POLAR);             // 毛鳞鱼：极地饵料鱼
        putMods("atlantic_herring", M_POLAR);    // 大西洋鲱：群游小鱼
        putMods("wolffish", M_POLAR);            // 狼鱼：碎壳专家
        putMods("redfish", M_POLAR);             // 平鲉（红鱼）：慢速底层
        putMods("sablefish", M_POLAR);           // 裸盖鱼（银鳕）：深水泥底
        putMods("atlantic_cod", M_POLAR);        // 大西洋鳕：极地主力
        putMods("greenland_halibut", M_POLAR);   // 格陵兰大比目鱼：底层巨物
        putMods("greenland_shark", M_POLAR);     // 格陵兰鲨：极地终极（传说）

        // ================================================================ 远洋（第 4 批，用户 2026-10-08）
        //
        // ⚠ 这 5 条**都是本体鱼**（没有修饰）—— 与极地那批不同：
        //   旗鱼/鲯鳅认深海、巨暹罗鲤认河流、鳄雀鳝认河湖（入侵种）、电鳗认沼泽与河流 ✓
        // ⚠ 深海会被稀释（原本 6 种 + 旗鱼/鲯鳅 = 8 种 → 老鱼 75%，正好压线），
        //   所以这两条都放在**金红档**（权重天然最低）✓ 见 check-water-body 第 ⑩ 节。
        put("sailfish", M_DEEP);
        put("mahi_mahi", M_DEEP);
        put("alligator_gar", M_RIVER | M_LAKE);
        put("giant_siamese_carp", M_RIVER);
        put("electric_eel", M_SWAMP | M_RIVER);
    }

    /** 某个鱼种出现在哪几类水里。表里没有就返回 0（= 哪都不出，会被检查脚本拦下）。 */
    public static int maskOf(String speciesId) {
        Integer m = TABLE.get(speciesId);
        return m == null ? 0 : m;
    }

    /** 鱼种是否出现在该水体。 */
    public static boolean livesIn(String speciesId, WaterBody water) {
        return water != null && water.matches(maskOf(speciesId));
    }

    /** 表里登记了多少种（供检查脚本对账）。 */
    public static int size() {
        return TABLE.size();
    }

    /** 某个鱼种要求的**修饰**位掩码；0 = 不挑修饰（只看水体本体）。 */
    public static int modsOf(String speciesId) {
        Integer m = MODS.get(speciesId);
        return m == null ? 0 : m;
    }

    /** 登记了修饰的鱼种数（供检查脚本对账）。 */
    public static int modsSize() {
        return MODS.size();
    }

    /** 所有"要求修饰"的 id（供检查脚本对账）。 */
    public static java.util.Set<String> modsIds() {
        return java.util.Collections.unmodifiableSet(MODS.keySet());
    }

    /** 所有已登记的 id（供检查脚本对账）。 */
    public static java.util.Set<String> ids() {
        return java.util.Collections.unmodifiableSet(TABLE.keySet());
    }
}
