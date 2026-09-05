/** 编辑器块(纯数据;客户端 editor.store 持有草稿,保存时经 api 写回服务端) */
export interface EditorBlock {
  id: string
  type: 'text'
  text: string
}

/** 文档 = 块列表。服务端读写单位(mock/db.ts 用它存储)。 */
export interface EditorDocument {
  blocks: EditorBlock[]
}
