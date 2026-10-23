package com.whitecobalt.anglertackle.registry;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.levelgen.structure.Structure;

/**
 * 本模组用到的标签。
 *
 * <p>现在只有一个：结构标签 {@link #FISHERMAN_HUT}。
 * 追踪罗盘靠它找屋子 —— 原版的
 * {@code ServerLevel.findNearestMapStructure(TagKey<Structure>, ...)}
 * 只认标签，不认单个结构 id，所以哪怕只有一个结构也必须包一层标签。
 *
 * <p>标签内容在 {@code data/anglertackle/tags/worldgen/structure/fisherman_hut.json}。
 * ⚠ 标签是**数据包**内容，不是注册表内容：写错了不会崩，
 * 只会表现为"罗盘永远说附近没有小屋"。所以 `tools/check-tracking-compass.js`
 * 会断言这个 json 存在、且里面确实列了 {@code anglertackle:fisherman_hut}。
 */
public final class ModTags {

    /** 渔人小屋。内容：{@code anglertackle:fisherman_hut}。 */
    public static final TagKey<Structure> FISHERMAN_HUT = TagKey.create(
            Registries.STRUCTURE,
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "fisherman_hut"));

    // ------------------------------------------------------------------ 物品标签（docs/30：联动用）
    //
    // 这几个标签是**"同类可替代"的收口点**（用户 2026-10-03 定案）：
    // 配方需求写在标签上、不写死在某个物品上，于是别的模组的同类物品只要进标签就能顶替
    // （森罗物语的「油脂」顶鱼油、国味的「盐」顶我们的盐）。
    //
    // ⚠ 标签里引用**别人的**物品时，条目必须写 `"required": false`（原版 1.21 原生支持）：
    //   没装那个模组时，缺条目不会让整个标签加载失败、也不报错。
    //   守着这条的是 tools/check-kaleidoscope-compat.js。

    /** 食用油（我们：鱼油；可选：森罗物语厨房的「油脂」）。 */
    public static final TagKey<Item> COOKING_OIL = itemTag("cooking_oil");

    /** 盐（我们：盐；可选：森罗物语国味的「盐」）。 */
    public static final TagKey<Item> SALT = itemTag("salt");

    /** 厨刀（我们：鱼刀；可选：森罗物语的铁/金/钻石/下界合金菜刀）。 */
    public static final TagKey<Item> KITCHEN_KNIFE = itemTag("kitchen_knife");

    /** 熟鱼块（我们三档的熟块，给联动配方与通用标签用）。 */
    public static final TagKey<Item> COOKED_FISH_CHUNK = itemTag("cooked_fish_chunk");

    /** 生鱼块（我们三档的生块）。 */
    public static final TagKey<Item> RAW_FISH_CHUNK = itemTag("raw_fish_chunk");

    private static TagKey<Item> itemTag(String path) {
        return TagKey.create(Registries.ITEM,
                Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, path));
    }

    private ModTags() {
    }
}
