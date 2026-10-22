package com.whitecobalt.anglertackle.registry;

/*
 * ⚠ 本文件由 tools/gen-fish-model.js **整份生成**，不要手工修改。
 *   重新生成：node tools/gen-fish-model.js
 */

import com.whitecobalt.anglertackle.AnglersTackle;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.resources.ResourceLocation;

/**
 * 模型层（LayerDefinition）的声明。
 *
 * <p>⚠ 1.21 把两件事拆开了：ModelLayers 只声明 ModelLayerLocation 常量，
 * 真正的 LayerDefinition 注册在 geom/LayerDefinitions 里。我们自己的模型自己注册，
 * 所以这个类只放常量声明。
 *
 * <p><b>一种鱼一层</b>（21 层），不是 4 组共用 —— 理由见 ModFishModel 的类注释。
 * 层 id → 烘哪套网格的映射由 {@code ClientSetup} 直接遍历本表注册，两边不会走散。
 */
public final class ModModelLayers {

    /** 鱼种 id → 模型层。 */
    public static final Map<String, ModelLayerLocation> FISH = buildFishLayers();

    private static Map<String, ModelLayerLocation> buildFishLayers() {
        String[] species = {"tilapia", "african_butterflyfish", "crucian_carp", "mirror_carp", "jewel_cichlid", "mullet", "zander", "atlantic_salmon", "bluefin_tuna", "brown_trout", "tigerfish", "topmouth_culter", "hemiculter", "striped_bass", "platinum_arowana", "oxeye_tarpon", "banded_loach", "guppy", "elephantnose", "golden_loach", "cave_blindfish", "grass_carp", "black_carp", "pike", "arapaima", "north_african_catfish", "sapphire_snakehead", "juvenile_shark", "arctic_char", "whitefish", "rainbow_trout", "burbot", "taimen", "arctic_cod", "capelin", "atlantic_herring", "wolffish", "redfish", "sablefish", "atlantic_cod", "greenland_halibut", "greenland_shark", "sailfish", "mahi_mahi", "alligator_gar", "giant_siamese_carp", "electric_eel"};
        Map<String, ModelLayerLocation> map = new LinkedHashMap<>();
        for (String s : species) {
            map.put(s, new ModelLayerLocation(
                    ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "fish_" + s), "main"));
        }
        return Map.copyOf(map);
    }

    private ModModelLayers() {
    }
}
