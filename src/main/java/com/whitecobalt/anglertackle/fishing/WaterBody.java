package com.whitecobalt.anglertackle.fishing;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Blocks;

/**
 * 水体类型 —— 决定"这片水里能出哪些鱼"。
 *
 * <h2>为什么按群系判，而不是按"离岸距离 / 是不是湖"</h2>
 * 用户定案："水体是判断当前是什么群系会出什么鱼。"
 *
 * <p>群系是 MC 里**已经有权威定义**的东西（数据包、模组、地形生成器都会写它），
 * 而"这是湖还是河"要靠扫地形去猜 —— 猜法一旦有偏差，玩家的体感就是
 * "这明明是条河却钓出湖鱼"，而且极难调。群系判定没有这种模糊地带。
 *
 * <h2>六类</h2>
 * <ul>
 *   <li>{@link #RIVER} 河流（含冻河）</li>
 *   <li>{@link #LAKE} 湖泊 —— 所有"有静水但不是河/海/沼泽"的群系，
 *       包括玩家自己挖的池塘（那片水所在的群系通常是平原/森林）</li>
 *   <li>{@link #SWAMP} 沼泽（含红树林沼泽）</li>
 *   <li>{@link #OCEAN} 海洋（非深海群系）</li>
 *   <li>{@link #DEEP_OCEAN} 深海</li>
 *   <li>{@link #CAVE} 洞穴水域 —— **两道路**：先看"y&lt;55 且上下 20 格里有
 *       洞穴标志方块"（地下判定），再看三个原版洞穴群系</li>
 * </ul>
 *
 * <p><b>为什么洞穴要单独走一条"地下判定"</b>（用户 2026-10-02 实测后定案）：
 * 洞穴在 MC 里是**地形**而不是群系 —— 在河流/平原群系地下挖出来的溶洞，
 * {@code getBiome()} 返回的仍然算河流/平原，按群系判就只会出地表鱼。
 * 判据取"这一带有没有只有洞穴才长的方块"（苔藓/滴水石/幽匿……），
 * 而不是天光或水深 —— 后者会把所有深水都判成洞穴（见 {@link #looksLikeCave} 的说明）。
 */
public enum WaterBody {

    RIVER("河流"),
    LAKE("湖泊"),
    SWAMP("沼泽"),
    OCEAN("海洋"),
    /** 深海。**同时也会出普通海洋的鱼** —— 见 {@link #matches}。 */
    DEEP_OCEAN("深海"),
    /**
     * 洞穴水域。
     *
     * <p><b>判据有两级，优先级从高到低：</b>
     * <ol>
     *   <li><b>地下判定</b>：y &lt; 55 且以落点为起点上下各 20 格内能找到
     *       {@link #CAVE_BLOCKS 洞穴标志方块} —— 玩家自己找到的洞基本都走这条；</li>
     *   <li><b>群系判定</b>：原版三个洞穴群系 {@code lush_caves} /
     *       {@code dripstone_caves} / {@code deep_dark}。1.21.1 的原版群系标签里
     *       **没有 {@code is_cave}**（从游戏 jar 里列过 {@code data/minecraft/tags/worldgen/biome/}，
     *       只有 is_ocean / is_river / is_swamp / is_beach 这类地形标签），所以只能按 id 显式匹配。</li>
     * </ol>
     *
     * <p>两级都不满足的地下湖会落回"湖泊" —— 比如玩家自己挖的池塘、矿道尽头的水坑
     * （那里长不出苔藓与幽匿）。这是有意的：那种水本来就该出地表鱼。
     */
    CAVE("洞穴水域");

    // ---------------------------------------------------------------- 鱼种掩码
    //
    // 鱼种那边用位掩码声明"我出现在哪几类水里"。用 int 而不是 EnumSet：
    // 21 条鱼的数据写在一张表里，位或写起来短、看一眼就知道范围。

    public static final int M_RIVER = 1;
    public static final int M_LAKE = 1 << 1;
    public static final int M_SWAMP = 1 << 2;
    public static final int M_OCEAN = 1 << 3;
    public static final int M_DEEP = 1 << 4;
    public static final int M_CAVE = 1 << 5;
    // ---- 水域修饰（叠加，不是新的水体值）----
    // 用户 2026-10-08：极地 / 高寒湖 / 冷水溪流 **不做成新的水体值**，而是叠加修饰。
    // 做成新枚举值的代价（读代码后确认）：① 现有"深海继承海洋"那条特判要给每个水体补一遍；
    // ② check-water-body 的 96 组合判据会整片失效。而语义上它们本来就是"湖泊 + 冷"
    //    "任意水体 + 极地群系"，是修饰。普通鱼种因此**继续出现在这些水域** ✓。
    public static final int M_POLAR = 1 << 6;
    public static final int M_ALPINE_LAKE = 1 << 7;
    public static final int M_COLD_STREAM = 1 << 8;

    /** 自己对应的那一位。 */
    public int mask() {
        return switch (this) {
            case RIVER -> M_RIVER;
            case LAKE -> M_LAKE;
            case SWAMP -> M_SWAMP;
            case OCEAN -> M_OCEAN;
            case DEEP_OCEAN -> M_DEEP;
            case CAVE -> M_CAVE;
        };
    }

    /**
     * 鱼种的掩码是否"包含"这个水体。
     *
     * <p>深海特判：在深海钓鱼时，普通海洋的鱼**也会出现**。
     * 现实里近海鱼本来就会游到远海，游戏里这条也很重要 ——
     * 不然深海会变成"只出金枪鱼和鲨鱼"的单点池，而台钓竿在深海
     * 会直接无鱼可钓（那几种都是路亚鱼）。归属感上也没问题：
     * 玩家在深海钓到一条鲻鱼，不会觉得奇怪。
     */
    public boolean matches(int speciesMask) {
        if ((speciesMask & mask()) != 0) {
            return true;
        }
        return this == DEEP_OCEAN && (speciesMask & M_OCEAN) != 0;
    }

    /** 中文名，给提示与日志用。 */
    public String cn() {
        return cn;
    }

    private final String cn;

    WaterBody(String cn) {
        this.cn = cn;
    }

    // ---------------------------------------------------------------- 判定

    private static final TagKey<Biome> IS_RIVER = tag("is_river");
    private static final TagKey<Biome> IS_OCEAN = tag("is_ocean");
    private static final TagKey<Biome> IS_DEEP_OCEAN = tag("is_deep_ocean");
    private static final TagKey<Biome> IS_SWAMP = tag("is_swamp");
    private static final TagKey<Biome> IS_BEACH = tag("is_beach");

    private static TagKey<Biome> tag(String path) {
        return TagKey.create(Registries.BIOME, ResourceLocation.withDefaultNamespace(path));
    }

    /**
     * 判定落点水体 —— **只看群系**。
     *
     * <h2>为什么不做"洞穴水域"</h2>
     * 用户定案："你应该直接根据我的世界中的群系判定做这个，比你自己弄还少一道程序。"
     *
     * <p>我先前额外加了一层"头顶没天光 + 水深≥4 → 洞穴"，结果是**引入 bug 的那一层**：
     * {@code canSeeSky} 用的是 MOTION_BLOCKING 高度图，而**流体也算遮挡** ——
     * 浮漂浮在水面上时它所在那格就是水，于是 {@code canSeeSky(水面)} 恒为 false。
     * 任何水深 ≥ 4 的**开阔水域**都会被判成洞穴。
     * 实测后果：玩家在下界合金路亚竿 + 测试拟饵（必出红）的情况下，
     * 在海洋里钓出一堆绿鲫鱼 —— 海洋被误判成洞穴，而洞穴里唯一够 5 档的
     * 蓝宝石雷龙是台钓鱼，于是"路亚 + 要求≥5档"变成空池，落到鲫鱼兜底。
     *
     * <p>群系判定少一道程序，也没有这种"我以为是 A、实际是 B"的余地：
     * 地下湖在"繁茂洞穴"群系里 → 判成湖泊；玩家挖的池塘在平原里 → 也是湖泊。
     * 这本来就是玩家能接受、也能预期的分类方式。
     */
    // ---------------------------------------------------------------- 地下判定
    //
    // 用户 2026-10-02（实测反馈）：
    //   "我刚刚在溶洞拿台钓红饵紫窝半天全是草鱼青鱼。"
    //   根因：**洞穴是地形，不是群系**。在河流/平原群系的地下挖出来的那个溶洞，
    //   getBiome() 返回的仍然是 minecraft:river / plains，于是判成河流/湖泊，
    //   出的自然是地表鱼（草鱼、青鱼都是河/湖鱼）。只有繁茂洞穴、溶洞（钟乳石洞）、
    //   深暗之域这三个**洞穴群系**才判得出洞穴 —— 玩家的洞十有八九不是这三个。
    //
    // 用户定案（同一天）：
    //   "加加地下判定，y55 以下只要水纵向上下延伸 20 格内存在洞穴里有的方块就算洞穴。"

    /** 地下判定只在海平面以下生效 —— 地表水的 y 一般 ≥62，不会被卷进来。 */
    private static final int CAVE_MAX_Y = 55;

    /** 以水面为起点，**上下各**扫这么多格找洞穴标志方块。 */
    private static final int CAVE_SCAN = 20;

    /**
     * "只有洞穴里才长得出来"的方块 —— 三种原版洞穴群系的标志物。
     *
     * <p><b>为什么不看天光</b>（{@code canSeeSky}）：水面那一格自己就"看不见天"
     * ——MOTION_BLOCKING 高度图把流体也算作遮挡，于是 {@code canSeeSky(水面)} 恒为 false，
     * 任何水深 ≥4 的开阔水域都会被判成洞穴。2026-10-01 就是这么在海洋里钓出一堆绿鲫鱼的。
     * 看方块是"这一带确实是天然洞穴"的直接证据，与水深、光线都无关。
     *
     * <p><b>为什么不用石头 / 深板岩 / 凝灰岩</b>：那是**任何**地下都有的东西，
     * 连玩家自己挖的洞、矿道、地下室也算 —— 用它们判等于"y&lt;55 的水一律是洞穴"，
     * 那和"看 y 坐标就够了"没区别，会把地下湖里的地表鱼全砍掉。
     * 这里挑的全是**群系专属的自然装饰**：苔藓与杜鹃（繁茂洞穴）、滴水石与方解石（溶洞）、
     * 幽匿系列（深暗之域）。玩家挖的洞里长不出这些。
     */
    private static final java.util.Set<net.minecraft.world.level.block.Block> CAVE_BLOCKS =
            java.util.Set.of(
                    // 繁茂洞穴
                    Blocks.MOSS_BLOCK, Blocks.MOSS_CARPET,
                    Blocks.AZALEA, Blocks.FLOWERING_AZALEA,
                    Blocks.AZALEA_LEAVES, Blocks.FLOWERING_AZALEA_LEAVES,
                    Blocks.CAVE_VINES, Blocks.CAVE_VINES_PLANT,
                    Blocks.SPORE_BLOSSOM, Blocks.GLOW_LICHEN,
                    Blocks.SMALL_DRIPLEAF, Blocks.BIG_DRIPLEAF, Blocks.BIG_DRIPLEAF_STEM,
                    Blocks.HANGING_ROOTS, Blocks.ROOTED_DIRT,
                    // 溶洞（钟乳石洞）
                    Blocks.DRIPSTONE_BLOCK, Blocks.POINTED_DRIPSTONE, Blocks.CALCITE,
                    // 深暗之域
                    Blocks.SCULK, Blocks.SCULK_VEIN, Blocks.SCULK_CATALYST,
                    Blocks.SCULK_SHRIEKER, Blocks.SCULK_SENSOR);

    /**
     * 这一带看起来像天然洞穴吗：y &lt; {@value #CAVE_MAX_Y}，
     * 且以落点为起点**上下各 {@value #CAVE_SCAN} 格**里能找到洞穴标志方块。
     *
     * <p>纵向只扫一列（落点所在的那一列）：玩家在洞里抛竿时，落点上下就是洞壁与洞顶，
     * 扫一列既便宜又够准；横扫一片反而会把"地表水旁边恰好有个洞口"误判进来。
     */
    public static boolean looksLikeCave(ServerLevel level, BlockPos pos) {
        if (pos.getY() >= CAVE_MAX_Y) {
            return false;
        }
        int from = Math.max(level.getMinBuildHeight(), pos.getY() - CAVE_SCAN);
        int to = Math.min(level.getMaxBuildHeight() - 1, pos.getY() + CAVE_SCAN);
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int y = from; y <= to; y++) {
            if (CAVE_BLOCKS.contains(level.getBlockState(p.set(pos.getX(), y, pos.getZ())).getBlock())) {
                return true;
            }
        }
        return false;
    }

    /** 原版三个洞穴群系。见 {@link #CAVE} 的说明：1.21.1 没有 is_cave 标签。 */
    private static final java.util.Set<ResourceLocation> CAVE_BIOMES = java.util.Set.of(
            ResourceLocation.withDefaultNamespace("lush_caves"),      // 繁茂洞穴
            ResourceLocation.withDefaultNamespace("dripstone_caves"), // 溶洞
            ResourceLocation.withDefaultNamespace("deep_dark"));      // 深暗之域

    public static WaterBody detect(ServerLevel level, BlockPos pos) {        // ① 地下水域优先（用户 2026-10-02 定案）。
        //    必须放在群系判定**之前**：地下暗河的群系往往还是地表群系
        //    （河流 / 平原），先查群系的话洞里永远是地表鱼。
        if (looksLikeCave(level, pos)) {
            return CAVE;
        }
        Holder<Biome> biome = level.getBiome(pos);
        // ② 洞穴群系：原版三个归一类。
        //    注意这里**只是查群系 id**，不碰天光也不碰水深 ——
        //    早先那版用 canSeeSky 判洞穴，而水面方块自己就"看不见天"，
        //    结果所有深水都被判成洞穴（海洋里出绿鲫鱼那个事故）。
        if (biome.unwrapKey().map(k -> CAVE_BIOMES.contains(k.location())).orElse(false)) {
            return CAVE;
        }
        if (biome.is(IS_DEEP_OCEAN)) {
            return DEEP_OCEAN;
        }
        if (biome.is(IS_OCEAN)) {
            return OCEAN;
        }
        if (biome.is(IS_RIVER)) {
            return RIVER;
        }
        if (biome.is(IS_SWAMP)) {
            return SWAMP;
        }
        // 沙滩上的水：群系是沙滩，但水通常是海的延伸。
        // 不判这一条的话，海边浅水会被当成"湖泊"，出一堆淡水鱼。
        if (biome.is(IS_BEACH)) {
            return OCEAN;
        }
        // 其余一切有静水的地方：湖泊（含玩家自己挖的池塘、地下湖）
        return LAKE;
    }

    // ================================================================ 水域修饰（叠加）
    //
    // 用户 2026-10-08 定案。三个修饰全部**只看群系/高度**，与水体本体同一套口径
    // （"水体是判断当前是什么群系会出什么鱼"）。

    /** 极地：常年覆冰且**非高山**（用户："仅适用于非高山且常年覆冰群系"）。 */
    private static final TagKey<Biome> IS_ICE_FISHING = modTag("ice_fishing");
    /** 高山群系。JSON 标签表达不了"不在某某标签里"，所以"非高山"这条**写在代码里**。 */
    private static final TagKey<Biome> IS_ALPINE = modTag("alpine");
    /** 冷水溪流的显式名单（温度判据的补充，方便数据包加群系）。 */
    private static final TagKey<Biome> IS_COLD_STREAM = modTag("cold_streams");

    private static TagKey<Biome> modTag(String path) {
        return TagKey.create(Registries.BIOME, ResourceLocation.parse("anglertackle:" + path));
    }

    /**
     * 这片水命中的**修饰**（位掩码，可以同时命中多个；没有就是 0）。
     *
     * <ul>
     *   <li><b>极地</b>：群系在 {@code #anglertackle:ice_fishing} 且**不在**
     *       {@code #anglertackle:alpine}；</li>
     *   <li><b>高寒湖</b>：水体是湖泊，且（落点 y ≥ {@code alpineLakeMinY} 或群系在高山标签里）；</li>
     *   <li><b>冷水溪流</b>：水体是河流，且（群系基础温度 ≤ {@code coldWaterMaxTemp}
     *       或群系在 {@code #anglertackle:cold_streams}）。</li>
     * </ul>
     *
     * <p>⚠ <b>温度阈值默认 0.3，不是 0.2</b>：MC 里 {@code taiga} 是 0.25、{@code plains} 是 0.8 ——
     * 取 0.2 会把**针叶林溪流**排除掉，而哲罗鲑、细鳞鲑现实里就活在那种水里。
     *
     * <p>⚠ 两个阈值都是配置项（调参器可改），不要写死 —— 这条规矩吃过亏：
     * 写死的数字在调参器里改了没反应，玩家会以为配置是坏的。
     */
    public static int modifiers(ServerLevel level, BlockPos pos, WaterBody body) {
        Holder<Biome> biome = level.getBiome(pos);
        boolean alpine = biome.is(IS_ALPINE);
        int mask = 0;
        if (biome.is(IS_ICE_FISHING) && !alpine) {
            mask |= M_POLAR;
        }
        if (body == LAKE && (pos.getY() >= Tuning.alpineLakeMinY() || alpine)) {
            mask |= M_ALPINE_LAKE;
        }
        if (body == RIVER && (biome.value().getBaseTemperature() <= Tuning.coldWaterMaxTemp()
                || biome.is(IS_COLD_STREAM))) {
            mask |= M_COLD_STREAM;
        }
        return mask;
    }

    /**
     * 落点群系是不是"**非高山且常年覆冰**"（用户 2026-10-08 定的冰钓适用范围，docs/33 §8.5）。
     *
     * <p>这就是 {@link #M_POLAR} 那条判据的布尔版。"非高山"这一半**只能写在代码里** ——
     * JSON 标签表达不了"不在某某标签里"。
     *
     * <p>为什么单独开一个方法：冰钓那四条数值链（咬钩时间 / 金红爆率 / 线损 / 凿冰）
     * 都要问这一句，而它们**不该各自再拼一遍** `inTag(ice_fishing) && !inTag(alpine)` ——
     * 那是"同一个判断散在三处、改一处漏两处"的温床。
     */
    public static boolean iceFishingBiome(ServerLevel level, BlockPos pos) {
        Holder<Biome> biome = level.getBiome(pos);
        return biome.is(IS_ICE_FISHING) && !biome.is(IS_ALPINE);
    }

    /**
     * 把修饰掩码说成中文（调试命令用）。
     *
     * <p>为什么要有这条：修饰只从**群系标签 + 两个阈值**来，而"我站的这片雪原湖
     * 到底算不算高寒湖/极地水"光看代码推不出来 —— 标签引用的群系 id 只有数据包
     * 那边才知道。所以 {@code /atl water} 必须把命中的修饰原样打出来，
     * 而不是打一个布尔值让玩家猜。
     */
    public static String describeModifiers(int mask) {
        if (mask == 0) {
            return "无（普通水域）";
        }
        StringBuilder sb = new StringBuilder();
        for (Modifier m : Modifier.values()) {
            if ((mask & m.bit) != 0) {
                if (sb.length() > 0) {
                    sb.append(" + ");
                }
                sb.append(m.cn);
            }
        }
        return sb.toString();
    }

    /** 三种叠加修饰（位 + 中文名）。 */
    public enum Modifier {
        POLAR("极地水", M_POLAR),
        ALPINE_LAKE("高寒湖", M_ALPINE_LAKE),
        COLD_STREAM("冷水溪流", M_COLD_STREAM);

        public final String cn;
        public final int bit;

        Modifier(String cn, int bit) {
            this.cn = cn;
            this.bit = bit;
        }
    }
}
