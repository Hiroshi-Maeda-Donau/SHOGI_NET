from tensorflow import keras
from .constants import NUM_ACTIONS

def build_model(ch=64, blocks=8, C=43):
    inp = keras.Input(shape=(9,9,C))
    x = keras.layers.Conv2D(ch, 3, padding="same", use_bias=False)(inp)
    x = keras.layers.BatchNormalization()(x); x = keras.layers.ReLU()(x)

    def res(x):
        y = keras.layers.Conv2D(ch, 3, padding="same", use_bias=False)(x)
        y = keras.layers.BatchNormalization()(y); y = keras.layers.ReLU()(y)
        y = keras.layers.Conv2D(ch, 3, padding="same", use_bias=False)(y)
        y = keras.layers.BatchNormalization()(y)
        return keras.layers.ReLU()(keras.layers.add([x, y]))

    for _ in range(blocks):
        x = res(x)

    p = keras.layers.Conv2D(2, 1, use_bias=False)(x)
    p = keras.layers.BatchNormalization()(p); p = keras.layers.ReLU()(p)
    p = keras.layers.Flatten()(p)
    logits = keras.layers.Dense(NUM_ACTIONS)(p)

    model = keras.Model(inp, logits)
    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss=keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        metrics=["accuracy"]
    )
    return model

