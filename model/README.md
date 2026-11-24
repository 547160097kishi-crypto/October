# 十月 模型

`十月-test.glb` 由原始 `十月-test.gltf`（Cinema 4D 导出，407 MB，内嵌 base64）无损转换为二进制 GLB（305 MB），
压缩成 zip 后按 90 MB 切成 3 份（GitHub 单文件上限 100 MB）。

## 合并并解压

- **Windows（7-Zip）**：右键 `十月-test.glb.zip.001` → 7-Zip → 解压，会自动合并全部分卷。
- **Windows（命令行）**：`copy /b 十月-test.glb.zip.001+十月-test.glb.zip.002+十月-test.glb.zip.003 十月-test.glb.zip`，再解压。
- **macOS / Linux**：`cat 十月-test.glb.zip.0* > 十月-test.glb.zip && unzip 十月-test.glb.zip`

解压后 `十月-test.glb` 的 SHA-256：
`885ef1742e070109a67026ad920f93813dfaa972b43da5b4867e7cfb8d8d9d83`

模型含 1015 个 mesh、1 段动画，无贴图。
