// Textos de las muestras sintéticas como cadenas, para usarlas en el navegador sin leer el disco.
// ARCHIVO GENERADO a partir de packages/dian/muestras/: la prueba dian.test.ts verifica que
// coincida con los archivos. Datos 100 % inventados (NIT, CUFE, clientes y montos).

export interface MuestraDian {
  archivo: string;           // nombre del archivo real en muestras/
  tipo: 'xml' | 'csv';       // xml = factura o nota UBL; csv = extracto banco-csv-generico
  texto: string;
}

export const MUESTRAS_DIAN: MuestraDian[] = [
  {
    archivo: 'factura-LCE1001.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=182ce59a1d068e42dc37966422eaa79d1b4e7175995e43fe3c914756566ccd3ba53afe033e0215fb41205576658caa45&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1001</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">182ce59a1d068e42dc37966422eaa79d1b4e7175995e43fe3c914756566ccd3ba53afe033e0215fb41205576658caa45</cbc:UUID>
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-10-31</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Pedido mayorista octubre</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>2</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Distribuidora Andina de Café S.A.S.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-10-31</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">475000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">2500000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">475000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">62500.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">2500000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">62500.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>2.50</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>06</cbc:ID>
          <cbc:Name>ReteRenta</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">24150.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">2500000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">24150.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>0.966</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>07</cbc:ID>
          <cbc:Name>ReteICA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">2500000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">2500000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">2975000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">2975000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">50</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">1600000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">1600000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Café de origen Cauca 2,5 kg</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">32000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">30</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">900000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">171000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">900000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">171000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Panela orgánica caja x 24</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">30000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`,
  },
  {
    archivo: 'attached-LCE1002.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Contenedor SINTÉTICO (AttachedDocument) como el que se envía al adquirente: la factura va en CDATA. -->
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ccts="urn:un:unece:uncefact:data:specification:CoreComponentTypeSchemaModule:2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>Documentos adjuntos</cbc:CustomizationID>
  <cbc:ProfileID>Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>AD-LCE1002</cbc:ID>
  <cbc:IssueDate>2026-10-05</cbc:IssueDate>
  <cbc:IssueTime>10:20:00-05:00</cbc:IssueTime>
  <cbc:DocumentType>Contenedor de Factura Electrónica</cbc:DocumentType>
  <cbc:ParentDocumentID>LCE1002</cbc:ParentDocumentID>
  <cac:SenderParty>
    <cac:PartyTaxScheme>
      <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
      <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      <cac:TaxScheme>
        <cbc:ID>01</cbc:ID>
        <cbc:Name>IVA</cbc:Name>
      </cac:TaxScheme>
    </cac:PartyTaxScheme>
  </cac:SenderParty>
  <cac:ReceiverParty>
    <cac:PartyTaxScheme>
      <cbc:RegistrationName>Hotel Mirador del Valle &amp; Spa S.A.S.</cbc:RegistrationName>
      <cbc:CompanyID schemeAgencyID="195" schemeID="6" schemeName="31">900334455</cbc:CompanyID>
      <cac:TaxScheme>
        <cbc:ID>01</cbc:ID>
        <cbc:Name>IVA</cbc:Name>
      </cac:TaxScheme>
    </cac:PartyTaxScheme>
  </cac:ReceiverParty>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:MimeCode>text/xml</cbc:MimeCode>
      <cbc:EncodingCode>UTF-8</cbc:EncodingCode>
      <cbc:Description><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=dae6e60ad738c891939970f358885fb3d72f698f609beafb3b8a8b187e9dbc369ec9578ab074b2b1b058e5e6ee45de69&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1002</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">dae6e60ad738c891939970f358885fb3d72f698f609beafb3b8a8b187e9dbc369ec9578ab074b2b1b058e5e6ee45de69</cbc:UUID>
  <cbc:IssueDate>2026-10-05</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-11-04</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Servicio de surtido para eventos</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Hotel Mirador del Valle &amp; Spa S.A.S.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Hotel Mirador del Valle &amp; Spa S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="6" schemeName="31">900334455</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Hotel Mirador del Valle &amp; Spa S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="6" schemeName="31">900334455</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-11-04</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">798000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">4200000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">798000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">168000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">4200000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">168000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>4.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>06</cbc:ID>
          <cbc:Name>ReteRenta</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">4200000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">4200000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">4998000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">4998000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">4200000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">798000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">4200000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">798000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Servicio de surtido y montaje de estación de café</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">4200000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
  <cac:ParentDocumentLineReference>
    <cbc:LineID>1</cbc:LineID>
    <cac:DocumentReference>
      <cbc:ID>LCE1002</cbc:ID>
      <cbc:UUID schemeName="CUFE-SHA384">dae6e60ad738c891939970f358885fb3d72f698f609beafb3b8a8b187e9dbc369ec9578ab074b2b1b058e5e6ee45de69</cbc:UUID>
      <cbc:IssueDate>2026-10-05</cbc:IssueDate>
      <cbc:DocumentType>ApplicationResponse</cbc:DocumentType>
      <cac:Attachment>
        <cac:ExternalReference>
          <cbc:MimeCode>text/xml</cbc:MimeCode>
          <cbc:EncodingCode>UTF-8</cbc:EncodingCode>
          <cbc:Description><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>RESP-LCE1002</cbc:ID>
  <cbc:IssueDate>2026-10-05</cbc:IssueDate>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>02</cbc:ResponseCode>
      <cbc:Description>Documento validado por la DIAN (respuesta sintética)</cbc:Description>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>LCE1002</cbc:ID>
      <cbc:UUID schemeName="CUFE-SHA384">dae6e60ad738c891939970f358885fb3d72f698f609beafb3b8a8b187e9dbc369ec9578ab074b2b1b058e5e6ee45de69</cbc:UUID>
    </cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>]]></cbc:Description>
        </cac:ExternalReference>
      </cac:Attachment>
      <cac:ResultOfVerification>
        <cbc:ValidatorID>Unidad Especial Dirección de Impuestos y Aduanas Nacionales</cbc:ValidatorID>
        <cbc:ValidationResultCode>02</cbc:ValidationResultCode>
        <cbc:ValidationDate>2026-10-05</cbc:ValidationDate>
        <cbc:ValidationTime>10:19:00-05:00</cbc:ValidationTime>
      </cac:ResultOfVerification>
    </cac:DocumentReference>
  </cac:ParentDocumentLineReference>
</AttachedDocument>
`,
  },
  {
    archivo: 'factura-LCE1003.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=ba14fa3cdd29ff8d8b15aed35b71d26aaeda4500426c8156b2d52e1bd88eb639c1ef08acae13ac6dbbe266a66d742e53&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1003</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">ba14fa3cdd29ff8d8b15aed35b71d26aaeda4500426c8156b2d52e1bd88eb639c1ef08acae13ac6dbbe266a66d742e53</cbc:UUID>
  <cbc:IssueDate>2026-10-08</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-10-23</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Compra de contado a 15 días</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Restaurante Sabores del Pacífico Ltda.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Restaurante Sabores del Pacífico Ltda.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="7" schemeName="31">900556677</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Restaurante Sabores del Pacífico Ltda.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="7" schemeName="31">900556677</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-10-23</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">161500.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">850000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">161500.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">850000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">850000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1011500.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">1011500.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">20</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">850000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">161500.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">850000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">161500.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Aceite de coco 1 L &lt;orgánico&gt;</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">42500.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`,
  },
  {
    archivo: 'factura-LCE1004.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=52463e0652186530d0de0057fe217184737b83032d514e8b0875b65938bca82da3fbaffb29c4922a98d1ac5305198f4b&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1004</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">52463e0652186530d0de0057fe217184737b83032d514e8b0875b65938bca82da3fbaffb29c4922a98d1ac5305198f4b</cbc:UUID>
  <cbc:IssueDate>2026-10-09</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-11-08</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Refrigerios para jornada escolar</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Colegio Los Samanes</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Colegio Los Samanes</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="3" schemeName="31">860778899</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Colegio Los Samanes</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="3" schemeName="31">860778899</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-11-08</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">1600000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">40000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">1600000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">40000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>2.50</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>06</cbc:ID>
          <cbc:Name>ReteRenta</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">15456.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">1600000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">15456.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>0.966</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>07</cbc:ID>
          <cbc:Name>ReteICA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">1600000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">1600000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1904000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">1904000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">400</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">1600000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">1600000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">304000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Refrigerio empacado</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">4000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`,
  },
  {
    archivo: 'factura-LCE1005.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=1e5e26a5695a4d8c4f36cbf8243f3523c8f6dc0306452274047a245979ce2df8ecdf68dad6289d809c014b3e8d4db3cf&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1005</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">1e5e26a5695a4d8c4f36cbf8243f3523c8f6dc0306452274047a245979ce2df8ecdf68dad6289d809c014b3e8d4db3cf</cbc:UUID>
  <cbc:IssueDate>2026-10-13</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-11-12</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Cafetería de oficina, suministro mensual</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>2</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Oficinas Integrales del Cauca S.A.S.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Oficinas Integrales del Cauca S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="8" schemeName="31">901889900</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Oficinas Integrales del Cauca S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="8" schemeName="31">901889900</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-11-12</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">589000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">3100000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">589000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">77500.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">3100000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">77500.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>2.50</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>06</cbc:ID>
          <cbc:Name>ReteRenta</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">29946.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">3100000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">29946.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>0.966</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>07</cbc:ID>
          <cbc:Name>ReteICA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">3100000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">3100000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">3689000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">3689000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">100</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">2500000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">475000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">2500000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">475000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Café molido 500 g</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">25000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">40</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">600000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">114000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">600000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">114000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Azúcar &amp; endulzantes surtidos</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">15000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`,
  },
  {
    archivo: 'factura-LCE1006.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>LCE</sts:Prefix>
              <sts:From>1000</sts:From>
              <sts:To>5000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=d58c30d44539f11d7d05d43d3b0750f278eec1d5c13f0bd4701132044b73691c8b19e1885110593acc2f99391918666c&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>LCE1006</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">d58c30d44539f11d7d05d43d3b0750f278eec1d5c13f0bd4701132044b73691c8b19e1885110593acc2f99391918666c</cbc:UUID>
  <cbc:IssueDate>2026-10-15</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:DueDate>2026-11-14</cbc:DueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>Segundo pedido de octubre (pendiente de pago)</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Distribuidora Andina de Café S.A.S.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-11-14</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">228000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">1200000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">228000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">1200000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">1200000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1428000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">1428000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">25</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">1200000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">228000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">1200000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">228000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Cacao en grano 1 kg</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">48000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`,
  },
  {
    archivo: 'nota-credito-NCL21.xml',
    tipo: 'xml',
    texto: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Documento SINTÉTICO de muestra para el conciliador: datos inventados, no válido ante la DIAN. -->
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:QRCode>https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=605bcd5201fcaffd9ec26ea847285f7acd62c7bc1067436a94902fc761702a7d8f1e489f5b64eb16e763b447447620bf&amp;tipo=muestra</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Nota Crédito de Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>NCL21</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUDE-SHA384">605bcd5201fcaffd9ec26ea847285f7acd62c7bc1067436a94902fc761702a7d8f1e489f5b64eb16e763b447447620bf</cbc:UUID>
  <cbc:IssueDate>2026-10-20</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>
  <cbc:Note>Devolución de 5 unidades de cacao con empaque dañado</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>1</cbc:LineCountNumeric>
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>LCE1006</cbc:ReferenceID>
    <cbc:ResponseCode>1</cbc:ResponseCode>
    <cbc:Description>Devolución parcial de mercancía</cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>LCE1006</cbc:ID>
      <cbc:UUID schemeName="CUFE-SHA384">d58c30d44539f11d7d05d43d3b0750f278eec1d5c13f0bd4701132044b73691c8b19e1885110593acc2f99391918666c</cbc:UUID>
      <cbc:IssueDate>2026-10-15</cbc:IssueDate>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Tienda La Ceiba</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Tienda La Ceiba S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">900456789</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Distribuidora Andina de Café S.A.S.</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Distribuidora Andina de Café S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="4" schemeName="31">901223344</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">38000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">200000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">38000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">200000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">200000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">238000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">238000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:CreditNoteLine>
    <cbc:ID>1</cbc:ID>
    <cbc:CreditedQuantity unitCode="94">5</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">200000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">38000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">200000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">38000.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>Cacao en grano 1 kg (devolución)</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">40000.00</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:CreditNoteLine>
</CreditNote>
`,
  },
  {
    archivo: 'pagos-b2b.csv',
    tipo: 'csv',
    texto: `FECHA;DESCRIPCION;REFERENCIA;VALOR;SALDO
19/10/2026;SALDO ANTERIOR;;0,00;12.500.000,00
20/10/2026;TRANSF RESTAURANTE SABORES DEL PACIFICO;LCE1003;1.011.500,00;13.511.500,00
22/10/2026;ABONO PSE WOMPI;PED-2026-301145;145.000,00;13.656.500,00
30/10/2026;PAGO PROVEEDORES DISTRIBUIDORA ANDINA DE CAFE;LCE1001;2.888.350,00;16.544.850,00
31/10/2026;GMF 4X1000;;-11.553,40;16.533.296,60
04/11/2026;TRANSF HOTEL MIRADOR DEL VALLE;LCE1002;4.830.000,00;21.363.296,60
06/11/2026;TRANSF COLEGIO LOS SAMANES NIT 860778899;;1.848.544,00;23.211.840,60
09/11/2026;PAGO FACTURA OFICINAS INTEGRALES DEL CAUCA;LCE1005;3.581.554,00;26.793.394,60
10/11/2026;TOTAL ABONOS;;14.304.948,00;26.793.394,60
`,
  },
];

// Atajos: solo los XML (para leerFacturas) y el extracto de pagos B2B.
export const FACTURAS_MUESTRA: string[] = MUESTRAS_DIAN.filter((m) => m.tipo === 'xml').map((m) => m.texto);
export const PAGOS_B2B_MUESTRA: string = MUESTRAS_DIAN.find((m) => m.archivo === 'pagos-b2b.csv')?.texto ?? '';
