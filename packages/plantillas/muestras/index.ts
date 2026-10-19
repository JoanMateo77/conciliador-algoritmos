// Textos de las muestras como cadenas, para que funcionen igual en Node y en el navegador
// sin leer el disco. Deben ser idénticos a los archivos de esta carpeta: lo verifica
// packages/plantillas/muestras.test.ts. Si cambias un archivo, copia aquí su contenido.

export interface Muestra {
  id: string;
  nombre: string;
  lado: 'banco' | 'ventas';
  plantillaId: string;
  archivo: string; // nombre del archivo real en muestras/
  texto: string;
}

export const MUESTRAS: Muestra[] = [
  {
    id: 'ventas-wompi',
    nombre: 'Tienda La Ceiba: ventas Wompi (octubre 2026)',
    lado: 'ventas',
    plantillaId: 'wompi-transacciones',
    archivo: 'ventas-wompi.csv',
    texto: `id,created_at,reference,amount_in_cents,currency,status,payment_method_type,customer_email
99999-1790846062-10000,2026-10-01T09:14:22.000Z,PED-2026-104823,8950000,COP,APPROVED,PSE,cliente01@ejemplo.test
99999-1790852627-10037,2026-10-01T11:03:47.000Z,PED-2026-160021,3490000,COP,APPROVED,CARD,cliente02@ejemplo.test
99999-1790869959-10074,2026-10-01T15:52:39.000Z,PED-2026-160487,5780000,COP,APPROVED,CARD,cliente03@ejemplo.test
99999-1790932462-10111,2026-10-02T09:14:22.000Z,PED-2026-112268,38900000,COP,APPROVED,NEQUI,cliente04@ejemplo.test
99999-1790939027-10148,2026-10-02T11:03:47.000Z,PED-2026-115090,24500000,COP,DECLINED,CARD,cliente05@ejemplo.test
99999-1790956359-10185,2026-10-02T15:52:39.000Z,PED-2026-117350,24500000,COP,APPROVED,BANCOLOMBIA_TRANSFER,cliente06@ejemplo.test
99999-1791018862-10222,2026-10-03T09:14:22.000Z,PED-2026-126415,16890000,COP,APPROVED,CARD,cliente07@ejemplo.test
99999-1791196865-10259,2026-10-05T10:41:05.000Z,PED-2026-118842,52000000,COP,APPROVED,CARD,cliente08@ejemplo.test
99999-1791206896-10296,2026-10-05T13:28:16.000Z,PED-2026-121904,6230000,COP,APPROVED,PSE,cliente09@ejemplo.test
99999-1791278062-10333,2026-10-06T09:14:22.000Z,PED-2026-139921,7345000,COP,DECLINED,CARD,cliente10@ejemplo.test
99999-1791284627-10370,2026-10-06T11:03:47.000Z,PED-2026-140277,7345000,COP,APPROVED,CARD,cliente11@ejemplo.test
99999-1791371027-10407,2026-10-07T11:03:47.000Z,PED-2026-171032,4120000,COP,APPROVED,CARD,cliente12@ejemplo.test
99999-1791388359-10444,2026-10-07T15:52:39.000Z,PED-2026-171568,1875000,COP,APPROVED,CARD,cliente13@ejemplo.test
99999-1791394511-10481,2026-10-07T17:35:11.000Z,PED-2026-171944,9600000,COP,APPROVED,CARD,cliente14@ejemplo.test
99999-1791457427-10518,2026-10-08T11:03:47.000Z,PED-2026-147390,19990000,COP,APPROVED,CARD,cliente15@ejemplo.test
99999-1791537262-10555,2026-10-09T09:14:22.000Z,PED-2026-133018,41000000,COP,APPROVED,PSE,cliente16@ejemplo.test
99999-1791543827-10592,2026-10-09T11:03:47.000Z,PED-2026-176613,18000000,COP,ERROR,NEQUI,cliente17@ejemplo.test
99999-1791630227-10629,2026-10-10T11:03:47.000Z,PED-2026-152936,31200000,COP,APPROVED,CARD,cliente18@ejemplo.test
99999-1791796462-10666,2026-10-12T09:14:22.000Z,PED-2026-183205,2730000,COP,APPROVED,CARD,cliente19@ejemplo.test
99999-1791803027-10703,2026-10-12T11:03:47.000Z,PED-2026-183617,6490000,COP,APPROVED,CARD,cliente20@ejemplo.test
99999-1791889427-10740,2026-10-13T11:03:47.000Z,PED-2026-109377,13570000,COP,APPROVED,PSE,cliente21@ejemplo.test
99999-1791906759-10777,2026-10-13T15:52:39.000Z,PED-2026-184090,1560000,COP,APPROVED,CARD,cliente22@ejemplo.test
99999-1791912911-10814,2026-10-13T17:35:11.000Z,PED-2026-184452,11240000,COP,APPROVED,CARD,cliente23@ejemplo.test
99999-1791975827-10851,2026-10-14T11:03:47.000Z,PED-2026-188740,9900000,COP,VOIDED,CARD,cliente24@ejemplo.test
99999-1792055662-10888,2026-10-15T09:14:22.000Z,PED-2026-190553,28900000,COP,APPROVED,CARD,cliente25@ejemplo.test
`,
  },
  {
    id: 'extracto-banco',
    nombre: 'Tienda La Ceiba: extracto bancario (octubre 2026)',
    lado: 'banco',
    plantillaId: 'banco-csv-generico',
    archivo: 'extracto-banco.csv',
    texto: `FECHA;DESCRIPCION;REFERENCIA;VALOR;SALDO
30/09/2026;SALDO ANTERIOR;;0,00;2.350.000,00
01/10/2026;ABONO PSE WOMPI;PED-2026-104823;89.500,00;2.439.500,00
02/10/2026;LIQUIDACION WOMPI LOTE;WOMPI20261002;89.776,71;2.529.276,71
02/10/2026;ABONO PSE WOMPI;PED-2026-117350;245.000,00;2.774.276,71
05/10/2026;ABONO PSE WOMPI;PED-2026-121904;62.300,00;2.836.576,71
05/10/2026;ABONO WOMPI TARJETA;PED-2026-126415;163.573,74;3.000.150,45
06/10/2026;ABONO WOMPI TARJETA;PED-2026-118842;495.801,80;3.495.952,25
07/10/2026;ABONO WOMPI TARJETA;PED-2026-140277;71.133,75;3.567.086,00
08/10/2026;"LIQUIDACION WOMPI; LOTE 3 TRX";WOMPI20261008;151.032,11;3.718.118,11
09/10/2026;GMF 4X1000;;-48,00;3.718.070,11
09/10/2026;ABONO WOMPI TARJETA;PED-2026-147390;190.597,65;3.908.667,76
09/10/2026;CONSIGNACION EFECTIVO OFICINA;;350.000,00;4.258.667,76
09/10/2026;ABONO PSE WOMPI;PED-2026-133018;410.000,00;4.668.667,76
13/10/2026;ABONO WOMPI TARJETA;PED-2026-152936;302.161,08;4.970.828,84
14/10/2026;ABONO TRANSFERENCIA;PED-2026-109;135.700,00;5.106.528,84
14/10/2026;LIQUIDACION WOMPI LOTE;WOMPI20261014;213.255,99;5.319.784,83
15/10/2026;TOTAL ABONOS;;2.969.832,83;5.319.784,83
`,
  },
  {
    id: 'recaudo-asobancaria',
    nombre: 'Tienda La Ceiba: recaudo Asobancaria 2001 (14 oct 2026)',
    lado: 'banco',
    plantillaId: 'asobancaria-2001',
    archivo: 'recaudo-asobancaria.txt',
    texto: `0109999999912026101499900000012345678901202610141830A01                                                                                                           
0577099990000170001                                                                                                                                               
0600000000000000000000000000000000000000000010024500000012500000010141030055310099900420000001                                                                    
0600000000000000000000000000000000000000000010025100000008735000010141031755312999900420000002                                                                    
0600000000000000000000000000000000000000000010026300000034290000010241033455315899900420000003                                                                    
0600000000000000000000000000000000000000000010027000000005600000010141035155318799900420000004                                                                    
0600000000000000000000000000000000000000000010028800000021045000010341036855321699900420000005                                                                    
080000000050000000000821700000001                                                                                                                                 
09000000005000000000082170000                                                                                                                                     
`,
  },
  {
    id: 'ventas-erp',
    nombre: 'Tienda La Ceiba: facturas del ERP (octubre 2026)',
    lado: 'ventas',
    plantillaId: 'ventas-csv-generico',
    archivo: 'ventas-erp.csv',
    texto: `ID_VENTA,FECHA,CLIENTE,REFERENCIA,TOTAL
V-2101,2026-10-09,Cliente Ejemplo 01,100245,125000.00
V-2102,2026-10-10,Cliente Ejemplo 02,100251,87350.00
V-2103,2026-10-12,"Cliente Ejemplo 03, Sucursal Norte",100263,342900.00
V-2104,2026-10-13,Cliente Ejemplo 04,100270,56000.00
V-2105,2026-10-13,Cliente Ejemplo 05,100288,210450.00
V-2106,2026-10-14,Cliente Ejemplo 06,100294,99800.00
`,
  },
  {
    id: 'liquidacion-mercadopago',
    nombre: 'Tienda La Ceiba: liquidación Mercado Pago (octubre 2026)',
    lado: 'ventas',
    plantillaId: 'mercadopago-liquidacion',
    archivo: 'liquidacion-mercadopago.csv',
    texto: `SOURCE_ID,EXTERNAL_REFERENCE,TRANSACTION_DATE,TRANSACTION_TYPE,TRANSACTION_AMOUNT,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,TAXES_AMOUNT
81234560100,PED-2026-201114,2026-10-01T10:15:32.000-05:00,SETTLEMENT,150000.00,-6824.65,140925.35,-2250.00
81234560213,PED-2026-201387,2026-10-02T12:40:08.000-05:00,SETTLEMENT,89900.00,-4471.67,84079.83,-1348.50
81234560326,PED-2026-201652,2026-10-03T16:22:51.000-05:00,SETTLEMENT,45500.00,-2733.37,42084.13,-682.50
81234560439,PED-2026-201387,2026-10-05T09:05:44.000-05:00,REFUND,-89900.00,0.00,-89900.00,0.00
81234560552,PED-2026-202015,2026-10-06T11:48:19.000-05:00,SETTLEMENT,274000.00,-11679.37,258210.63,-4110.00
81234560665,PED-2026-202209,2026-10-08T14:31:02.000-05:00,SETTLEMENT,63200.00,-3426.34,58825.66,-948.00
81234560778,,2026-10-09T08:00:00.000-05:00,PAYOUTS,-400000.00,0.00,-400000.00,0.00
81234560891,PED-2026-202480,2026-10-09T17:12:37.000-05:00,SETTLEMENT,118750.00,-5601.19,111367.56,-1781.25
`,
  },
  {
    id: 'extracto-banco-mt940',
    nombre: 'Tienda La Ceiba: extracto MT940 (octubre 2026)',
    lado: 'banco',
    plantillaId: 'mt940-generico',
    archivo: 'extracto-banco-mt940.txt',
    texto: `:20:CEIBA261015
:25:9999/000123456789
:28C:00010/001
:60F:C260930COP2350000,00
:61:2610011001C89500,00NTRFPED-2026-104823//B2610010001
:86:ABONO PSE WOMPI
:61:261002C89776,71NTRFWOMPI20261002//B2610020002
:86:LIQUIDACION WOMPI LOTE
:61:2610021002C245000,00NTRFPED-2026-117350//B2610020003
:86:ABONO PSE WOMPI
:61:2610051005C62300,00NTRFPED-2026-121904//B2610050004
:86:ABONO PSE WOMPI
:61:261005C163573,74NTRFPED-2026-126415//B2610050005
:86:ABONO WOMPI TARJETA
:61:2610061006C495801,80NTRFPED-2026-118842//B2610060006
:86:ABONO WOMPI TARJETA
:61:2610071007C71133,75NTRFPED-2026-140277//B2610070007
:86:ABONO WOMPI TARJETA
:61:261008C151032,11NTRFWOMPI20261008//B2610080008
:86:LIQUIDACION WOMPI;
LOTE 3 TRX
:61:2610091009D48,00NCHGNONREF//B2610090009
:86:GMF 4X1000
:61:2610091009C190597,65NTRFPED-2026-147390//B2610090010
:86:ABONO WOMPI TARJETA
:61:261009C350000,00NCSHNONREF//B2610090011
:86:CONSIGNACION EFECTIVO OFICINA
:61:2610091009C410000,00NTRFPED-2026-133018//B2610090012
:86:ABONO PSE WOMPI
:61:2610131013C302161,08NTRFPED-2026-152936//B2610130013
:86:ABONO WOMPI TARJETA
:61:261014C135700,00NTRFPED-2026-109//B2610140014
:86:ABONO TRANSFERENCIA
:61:2610141014C213255,99NTRFWOMPI20261014//B2610140015
:86:LIQUIDACION WOMPI LOTE
:62F:C261015COP5319784,83
`,
  },
  {
    id: 'extracto-banco-camt053',
    nombre: 'Tienda La Ceiba: extracto camt.053 (octubre 2026)',
    lado: 'banco',
    plantillaId: 'camt053-generico',
    archivo: 'extracto-banco-camt053.xml',
    texto: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>CEIBA-20261015</MsgId>
      <CreDtTm>2026-10-15T18:00:00-05:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>CEIBA-2026-10</Id>
      <CreDtTm>2026-10-15T18:00:00-05:00</CreDtTm>
      <Acct>
        <Id>
          <Othr>
            <Id>000123456789</Id>
          </Othr>
        </Id>
        <Ccy>COP</Ccy>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="COP">2350000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-09-30</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="COP">5319784.83</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-10-15</Dt></Dt>
      </Bal>
      <Ntry>
        <Amt Ccy="COP">89500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-01</Dt></BookgDt>
        <ValDt><Dt>2026-10-01</Dt></ValDt>
        <AcctSvcrRef>B2610010001</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-104823</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO PSE WOMPI</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">89776.71</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-02</Dt></BookgDt>
        <ValDt><Dt>2026-10-02</Dt></ValDt>
        <AcctSvcrRef>B2610020002</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>WOMPI20261002</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>LIQUIDACION WOMPI LOTE</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">245000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-02</Dt></BookgDt>
        <ValDt><Dt>2026-10-02</Dt></ValDt>
        <AcctSvcrRef>B2610020003</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-117350</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO PSE WOMPI</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">62300.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-05</Dt></BookgDt>
        <ValDt><Dt>2026-10-05</Dt></ValDt>
        <AcctSvcrRef>B2610050004</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-121904</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO PSE WOMPI</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">163573.74</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-05</Dt></BookgDt>
        <ValDt><Dt>2026-10-05</Dt></ValDt>
        <AcctSvcrRef>B2610050005</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-126415</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO WOMPI TARJETA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">495801.80</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-06</Dt></BookgDt>
        <ValDt><Dt>2026-10-06</Dt></ValDt>
        <AcctSvcrRef>B2610060006</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-118842</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO WOMPI TARJETA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">71133.75</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-07</Dt></BookgDt>
        <ValDt><Dt>2026-10-07</Dt></ValDt>
        <AcctSvcrRef>B2610070007</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-140277</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO WOMPI TARJETA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">151032.11</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-08</Dt></BookgDt>
        <ValDt><Dt>2026-10-08</Dt></ValDt>
        <AcctSvcrRef>B2610080008</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>WOMPI20261008</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>LIQUIDACION WOMPI;</Ustrd>
              <Ustrd>LOTE 3 TRX</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">48.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-09</Dt></BookgDt>
        <ValDt><Dt>2026-10-09</Dt></ValDt>
        <AcctSvcrRef>B2610090009</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>GMF</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>NOTPROVIDED</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>GMF 4X1000</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">190597.65</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-09</Dt></BookgDt>
        <ValDt><Dt>2026-10-09</Dt></ValDt>
        <AcctSvcrRef>B2610090010</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-147390</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO WOMPI TARJETA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">350000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-09</Dt></BookgDt>
        <ValDt><Dt>2026-10-09</Dt></ValDt>
        <AcctSvcrRef>B2610090011</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>EFECTIVO</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>NOTPROVIDED</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>CONSIGNACION EFECTIVO OFICINA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">410000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-09</Dt></BookgDt>
        <ValDt><Dt>2026-10-09</Dt></ValDt>
        <AcctSvcrRef>B2610090012</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-133018</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO PSE WOMPI</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">302161.08</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-13</Dt></BookgDt>
        <ValDt><Dt>2026-10-13</Dt></ValDt>
        <AcctSvcrRef>B2610130013</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-152936</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO WOMPI TARJETA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">135700.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-14</Dt></BookgDt>
        <ValDt><Dt>2026-10-14</Dt></ValDt>
        <AcctSvcrRef>B2610140014</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>PED-2026-109</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>ABONO TRANSFERENCIA</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="COP">213255.99</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-14</Dt></BookgDt>
        <ValDt><Dt>2026-10-14</Dt></ValDt>
        <AcctSvcrRef>B2610140015</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>TRANSFERENCIA</Cd></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>WOMPI20261014</EndToEndId>
            </Refs>
            <RmtInf>
              <Ustrd>LIQUIDACION WOMPI LOTE</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>
`,
  },
  {
    id: 'extracto-banco-breb',
    nombre: 'Tienda La Ceiba: extracto con abonos Bre-B (octubre 2026)',
    lado: 'banco',
    plantillaId: 'banco-csv-generico',
    archivo: 'extracto-banco-breb.csv',
    texto: `FECHA;DESCRIPCION;REFERENCIA;VALOR;SALDO;REFERENCIA PAGO
30/09/2026;SALDO ANTERIOR;;0,00;2.350.000,00;
01/10/2026;ABONO PSE WOMPI;PED-2026-104823;89.500,00;2.439.500,00;
02/10/2026;TRANSFERENCIA BRE-B LLAVE @LACEIBA;;245.000,00;2.684.500,00;PED-2026-117350
05/10/2026;TRANSFERENCIA BRE-B LLAVE @LACEIBA;;62.300,00;2.746.800,00;PED-2026-121904
09/10/2026;GMF 4X1000;;-48,00;2.746.752,00;
09/10/2026;TRANSFERENCIA BRE-B LLAVE @LACEIBA;;410.000,00;3.156.752,00;PED-2026-133018
15/10/2026;TOTAL ABONOS;;806.800,00;3.156.752,00;
`,
  },
];
